package main

import (
	"fmt"
	"log/slog"

	solanago "github.com/gagliardetto/solana-go"
	solana "github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/solana"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"

	"orange-cre/contracts/solana/src/generated/ca_registry"
	"orange-cre/contracts/solana/src/generated/divstrip"
)

func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	schedule := config.Schedule
	if schedule == "" {
		schedule = "0 */5 * * * *"
	}

	cronTrigger := cron.Trigger(&cron.Config{Schedule: schedule})
	return cre.Workflow[*Config]{
		cre.Handler(cronTrigger, onCronTrigger),
	}, nil
}

func onCronTrigger(config *Config, runtime cre.Runtime, trigger *cron.Payload) (*SyncResult, error) {
	logger := runtime.Logger()
	logger.Info("xStocks CA sync started", "symbol", config.Symbol, "mint", config.Mint)

	historyURL := config.HistoryURL
	if historyURL == "" {
		historyURL = fmt.Sprintf(
			"https://api.xstocks.fi/api/v2/public/corporate-actions/history?symbol=%s&network=%s",
			config.Symbol,
			config.Network,
		)
	}
	upcomingURL := config.UpcomingURL
	if upcomingURL == "" {
		upcomingURL = fmt.Sprintf(
			"https://api.xstocks.fi/api/v2/public/corporate-actions/upcoming?symbol=%s&network=%s",
			config.Symbol,
			config.Network,
		)
	}

	client := &http.Client{}
	historyPromise := http.SendRequest(config, runtime, client, func(cfg *Config, _ *slog.Logger, sendRequester *http.SendRequester) ([]apiCorporateAction, error) {
		return fetchWithRequester(sendRequester, historyURL)
	}, cre.ConsensusIdenticalAggregation[[]apiCorporateAction]())

	upcomingPromise := http.SendRequest(config, runtime, client, func(cfg *Config, _ *slog.Logger, sendRequester *http.SendRequester) ([]apiCorporateAction, error) {
		return fetchWithRequester(sendRequester, upcomingURL)
	}, cre.ConsensusIdenticalAggregation[[]apiCorporateAction]())

	history, err := historyPromise.Await()
	if err != nil {
		return nil, fmt.Errorf("fetch history: %w", err)
	}
	upcoming, err := upcomingPromise.Await()
	if err != nil {
		return nil, fmt.Errorf("fetch upcoming: %w", err)
	}

	payload, err := buildSyncPayload(config, history, upcoming)
	if err != nil {
		return nil, fmt.Errorf("build payload: %w", err)
	}

	// CRE Solana write production limit is ~265 bytes per report. Sync one
	// event at a time so ForwarderReport(accountHash + SyncPayload) fits.
	// Default backfillMode=oldest: write the earliest complete history event.
	batchSize := config.MaxEventsPerWrite
	if batchSize <= 0 {
		batchSize = 1
	}
	if batchSize > len(payload.Events) {
		batchSize = len(payload.Events)
	}

	var writeEvents []SyncEvent
	backfillMode := config.BackfillMode
	if backfillMode == "" {
		backfillMode = "oldest"
	}
	if backfillMode == "oldest" && len(payload.Events) > 0 {
		writeEvents = payload.Events[:batchSize]
	} else if len(payload.Events) > 0 {
		writeEvents = payload.Events[len(payload.Events)-batchSize:]
	}

	writePayload := SyncPayload{Mint: payload.Mint, Events: writeEvents}
	reportPayload := toGeneratedSyncPayload(writePayload)
	payloadBytes, err := reportPayload.Marshal()
	if err != nil {
		return nil, fmt.Errorf("encode payload: %w", err)
	}

	result := formatSyncResult(writePayload, payloadBytes)
	result.Symbol = config.Symbol
	result.EventCount = len(payload.Events)
	result.InsertedCount = len(writeEvents)

	if config.WriteOnchain {
		txStatus, txSig, err := writeSyncPayload(config, runtime, reportPayload)
		if err != nil {
			return nil, err
		}
		result.TxStatus = txStatus
		result.TxSignature = txSig
		logger.Info(
			"wrote SyncPayload via Solana WriteReport",
			"txStatus", txStatus,
			"txSignature", txSig,
			"wroteEvents", len(writeEvents),
			"totalFetched", len(payload.Events),
			"backfillMode", backfillMode,
		)

		// Option A: same workflow — after a Yield CA write, request YT DBC launch.
		if config.LaunchYtOnYield && len(writeEvents) > 0 && writeEvents[0].Kind == kindYield {
			kind := writeEvents[0].Kind
			result.WroteKind = &kind
			launchStatus, launchSig, launchErr := writeLaunchYt(config, runtime)
			if launchErr != nil {
				result.YtLaunchError = launchErr.Error()
				logger.Info(
					"YT launch WriteReport failed (CA sync still ok)",
					"err", launchErr.Error(),
				)
			} else {
				result.YtLaunchRequested = true
				result.YtLaunchTxStatus = launchStatus
				result.YtLaunchTxSignature = launchSig
				logger.Info(
					"requested YT window launch via divstrip.on_report",
					"txStatus", launchStatus,
					"txSignature", launchSig,
					"lockNonces", effectiveLockNonces(config),
				)
			}
		}
	} else {
		logger.Info(
			"built CA sync payload (writeOnchain=false)",
			"events", result.EventCount,
			"mint", result.Mint,
			"payloadBytes", len(payloadBytes),
		)
	}

	return result, nil
}

func effectiveLockNonces(config *Config) uint32 {
	if config.LockNonces == 0 {
		return 2
	}
	return config.LockNonces
}

func writeLaunchYt(config *Config, runtime cre.Runtime) (string, string, error) {
	divstripProgramID := config.DivstripProgramID
	if divstripProgramID == "" {
		divstripProgramID = "A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz"
	}

	client := &solana.Client{ChainSelector: config.ChainSelector}
	strip, err := divstrip.NewDivstrip(client)
	if err != nil {
		return "", "", fmt.Errorf("new divstrip client: %w", err)
	}

	forwarderStatePk := solanago.MustPublicKeyFromBase58(config.ForwarderState)
	divstripPk := solanago.MustPublicKeyFromBase58(divstripProgramID)
	forwarderProgramPk := solanago.MustPublicKeyFromBase58(config.ForwarderProgramID)
	mintPk := solanago.MustPublicKeyFromBase58(config.Mint)
	registryProgramPk := solanago.MustPublicKeyFromBase58(config.ReceiverProgramID)

	forwarderAuthority, _, err := solanago.FindProgramAddress(
		[][]byte{
			[]byte("forwarder"),
			forwarderStatePk[:],
			divstripPk[:],
		},
		forwarderProgramPk,
	)
	if err != nil {
		return "", "", fmt.Errorf("derive divstrip forwarder authority: %w", err)
	}

	registryPda, _, err := solanago.FindProgramAddress(
		[][]byte{
			[]byte("registry"),
			mintPk[:],
		},
		registryProgramPk,
	)
	if err != nil {
		return "", "", fmt.Errorf("derive registry pda: %w", err)
	}

	marketPda, _, err := solanago.FindProgramAddress(
		[][]byte{
			[]byte("strip"),
			mintPk[:],
		},
		divstripPk,
	)
	if err != nil {
		return "", "", fmt.Errorf("derive strip market pda: %w", err)
	}

	accounts := []*solana.AccountMeta{
		{PublicKey: forwarderStatePk[:], IsWritable: false},
		{PublicKey: forwarderAuthority[:], IsWritable: false},
		{PublicKey: registryPda[:], IsWritable: false},
		{PublicKey: marketPda[:], IsWritable: false},
	}

	computeLimit := config.ComputeLimit
	if computeLimit == 0 {
		computeLimit = 290_000
	}
	computeConfig := &solana.ComputeConfig{ComputeLimit: computeLimit}

	report := divstrip.LaunchYtReport{
		Mint:       mintPk,
		LockNonces: effectiveLockNonces(config),
	}

	runtime.Logger().Info(
		"Submitting LaunchYtReport to divstrip.on_report",
		"market", marketPda.String(),
		"registry", registryPda.String(),
		"lockNonces", report.LockNonces,
	)

	reply, err := strip.WriteReportFromLaunchYtReport(runtime, report, accounts, computeConfig).Await()
	if err != nil {
		return "", "", fmt.Errorf("WriteReportFromLaunchYtReport: %w", err)
	}

	txStatus := reply.GetTxStatus().String()
	txSig := ""
	if sig := reply.GetTxSignature(); len(sig) > 0 {
		var signature solanago.Signature
		copy(signature[:], sig)
		txSig = signature.String()
	}
	if msg := reply.GetErrorMessage(); msg != "" {
		runtime.Logger().Info("LaunchYt WriteReport errorMessage", "msg", msg)
	}

	return txStatus, txSig, nil
}

func writeSyncPayload(config *Config, runtime cre.Runtime, payload ca_registry.SyncPayload) (string, string, error) {
	client := &solana.Client{ChainSelector: config.ChainSelector}
	registry, err := ca_registry.NewCaRegistry(client)
	if err != nil {
		return "", "", fmt.Errorf("new ca_registry client: %w", err)
	}

	forwarderStatePk := solanago.MustPublicKeyFromBase58(config.ForwarderState)
	receiverPk := solanago.MustPublicKeyFromBase58(config.ReceiverProgramID)
	forwarderProgramPk := solanago.MustPublicKeyFromBase58(config.ForwarderProgramID)
	mintPk := solanago.MustPublicKeyFromBase58(config.Mint)

	forwarderAuthority, _, err := solanago.FindProgramAddress(
		[][]byte{
			[]byte("forwarder"),
			forwarderStatePk[:],
			receiverPk[:],
		},
		forwarderProgramPk,
	)
	if err != nil {
		return "", "", fmt.Errorf("derive forwarder authority: %w", err)
	}

	registryPda, _, err := solanago.FindProgramAddress(
		[][]byte{
			[]byte("registry"),
			mintPk[:],
		},
		receiverPk,
	)
	if err != nil {
		return "", "", fmt.Errorf("derive registry pda: %w", err)
	}

	accounts := []*solana.AccountMeta{
		{PublicKey: forwarderStatePk[:], IsWritable: false},
		{PublicKey: forwarderAuthority[:], IsWritable: false},
		{PublicKey: registryPda[:], IsWritable: true},
	}

	computeLimit := config.ComputeLimit
	if computeLimit == 0 {
		computeLimit = 290_000
	}
	computeConfig := &solana.ComputeConfig{ComputeLimit: computeLimit}

	runtime.Logger().Info(
		"Submitting SyncPayload to ca_registry.on_report",
		"registry", registryPda.String(),
		"forwarderAuthority", forwarderAuthority.String(),
		"events", len(payload.Events),
	)

	reply, err := registry.WriteReportFromSyncPayload(runtime, payload, accounts, computeConfig).Await()
	if err != nil {
		return "", "", fmt.Errorf("WriteReportFromSyncPayload: %w", err)
	}

	txStatus := reply.GetTxStatus().String()
	txSig := ""
	if sig := reply.GetTxSignature(); len(sig) > 0 {
		var signature solanago.Signature
		copy(signature[:], sig)
		txSig = signature.String()
	}

	if msg := reply.GetErrorMessage(); msg != "" {
		runtime.Logger().Info("WriteReport errorMessage", "msg", msg)
	}

	return txStatus, txSig, nil
}

func toGeneratedSyncPayload(payload SyncPayload) ca_registry.SyncPayload {
	events := make([]ca_registry.SyncEvent, 0, len(payload.Events))
	for _, event := range payload.Events {
		var eventID [16]uint8
		for i := 0; i < 16; i++ {
			eventID[i] = event.EventID[i]
		}
		events = append(events, ca_registry.SyncEvent{
			EventId:       eventID,
			CaType:        event.CaType,
			Kind:          event.Kind,
			EffectiveTs:   event.EffectiveTs,
			MultiplierOld: event.MultiplierOld,
			MultiplierNew: event.MultiplierNew,
		})
	}
	return ca_registry.SyncPayload{
		Mint:   payload.Mint,
		Events: events,
	}
}

func fetchWithRequester(sendRequester *http.SendRequester, url string) ([]apiCorporateAction, error) {
	resp, err := sendRequester.SendRequest(&http.Request{
		Url:    url,
		Method: "GET",
	}).Await()
	if err != nil {
		return nil, err
	}

	var page apiPage
	if err := jsonDecode(resp.Body, &page); err != nil {
		return nil, err
	}
	return page.Nodes, nil
}
