package main

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gagliardetto/solana-go"
)

const (
	caCashDividend  uint8 = 0
	caForwardSplit  uint8 = 1
	caReverseSplit  uint8 = 2
	caStockDividend uint8 = 3
	caSpinOff       uint8 = 4

	kindYield  uint8 = 0
	kindSupply uint8 = 1
	kindOther  uint8 = 2
)

type apiPage struct {
	Nodes []apiCorporateAction `json:"nodes"`
}

type apiCorporateAction struct {
	EventID          string  `json:"eventId"`
	CaType           string  `json:"caType"`
	EffectiveTimeUTC string  `json:"effectiveTimeUtc"`
	MultiplierOld    *string `json:"multiplierOld"`
	MultiplierNew    *string `json:"multiplierNew"`
}

type Config struct {
	Schedule           string `json:"schedule"`
	Symbol             string `json:"symbol"`
	Network            string `json:"network"`
	Mint               string `json:"mint"`
	HistoryURL         string `json:"historyUrl"`
	UpcomingURL        string `json:"upcomingUrl"`
	WriteOnchain       bool   `json:"writeOnchain"`
	ChainSelector      uint64 `json:"chainSelector,string"`
	ReceiverProgramID  string `json:"receiverProgramId"`
	ForwarderProgramID string `json:"forwarderProgramId"`
	ForwarderState     string `json:"forwarderState"`
	ComputeLimit       uint32 `json:"computeLimit"`
	MaxEventsPerWrite  int    `json:"maxEventsPerWrite"`
	BackfillMode       string `json:"backfillMode"`
}

type SyncResult struct {
	Symbol        string `json:"symbol"`
	Mint          string `json:"mint"`
	EventCount    int    `json:"eventCount"`
	InsertedCount int    `json:"insertedCount"`
	PayloadBase64 string `json:"payloadBase64"`
	TxStatus      string `json:"txStatus,omitempty"`
	TxSignature   string `json:"txSignature,omitempty"`
}

func fetchCorporateActions(client *http.Client, url string) ([]apiCorporateAction, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("GET %s: status %d body %s", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var page apiPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, fmt.Errorf("decode %s: %w", url, err)
	}
	return page.Nodes, nil
}

func buildSyncPayload(cfg *Config, history, upcoming []apiCorporateAction) (SyncPayload, error) {
	mint, err := solana.PublicKeyFromBase58(cfg.Mint)
	if err != nil {
		return SyncPayload{}, fmt.Errorf("invalid mint: %w", err)
	}

	merged := append([]apiCorporateAction{}, history...)
	merged = append(merged, upcoming...)

	sort.SliceStable(merged, func(i, j int) bool {
		return merged[i].EventID < merged[j].EventID
	})

	seen := make(map[string]struct{}, len(merged))
	events := make([]SyncEvent, 0, len(merged))

	for _, node := range merged {
		if _, ok := seen[node.EventID]; ok {
			continue
		}
		seen[node.EventID] = struct{}{}

		if node.MultiplierOld == nil || node.MultiplierNew == nil {
			continue
		}

		event, ok, err := apiNodeToSyncEvent(node)
		if err != nil {
			return SyncPayload{}, err
		}
		if !ok {
			continue
		}
		events = append(events, event)
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].EffectiveTs < events[j].EffectiveTs
	})

	return SyncPayload{Mint: mint, Events: events}, nil
}

func apiNodeToSyncEvent(node apiCorporateAction) (SyncEvent, bool, error) {
	caType, ok := caTypeFromString(node.CaType)
	if !ok {
		return SyncEvent{}, false, fmt.Errorf("unsupported caType %q", node.CaType)
	}
	kind, ok := caTypeToKind(node.CaType)
	if !ok {
		return SyncEvent{}, false, nil
	}

	if node.MultiplierOld == nil || node.MultiplierNew == nil {
		return SyncEvent{}, false, nil
	}

	effectiveTs, err := parseEffectiveTimestamp(node.EffectiveTimeUTC)
	if err != nil {
		return SyncEvent{}, false, err
	}

	multiplierOld, err := parseOptionalMultiplier(node.MultiplierOld)
	if err != nil {
		return SyncEvent{}, false, err
	}
	multiplierNew, err := parseOptionalMultiplier(node.MultiplierNew)
	if err != nil {
		return SyncEvent{}, false, err
	}
	if multiplierOld == 0 {
		return SyncEvent{}, false, nil
	}

	return SyncEvent{
		EventID:       hashEventID(node.EventID),
		CaType:        caType,
		Kind:          kind,
		EffectiveTs:   effectiveTs,
		MultiplierOld: multiplierOld,
		MultiplierNew: multiplierNew,
	}, true, nil
}

func caTypeToKind(value string) (uint8, bool) {
	switch value {
	case "CashDividend", "StockDividend":
		return kindYield, true
	case "ForwardSplit", "ReverseSplit":
		return kindSupply, true
	case "SpinOff":
		return kindOther, true
	default:
		return 0, false
	}
}

func selectOldestWritable(nodes []apiCorporateAction, knownEventIDs map[[16]byte]struct{}) (apiCorporateAction, bool) {
	sorted := append([]apiCorporateAction{}, nodes...)
	sort.SliceStable(sorted, func(i, j int) bool {
		ti, erri := parseEffectiveTimestamp(sorted[i].EffectiveTimeUTC)
		tj, errj := parseEffectiveTimestamp(sorted[j].EffectiveTimeUTC)
		if erri != nil || errj != nil {
			return sorted[i].EventID < sorted[j].EventID
		}
		if ti == tj {
			return sorted[i].EventID < sorted[j].EventID
		}
		return ti < tj
	})

	for _, node := range sorted {
		if node.MultiplierOld == nil || node.MultiplierNew == nil {
			continue
		}
		if _, ok := caTypeToKind(node.CaType); !ok {
			continue
		}
		id := hashEventID(node.EventID)
		if knownEventIDs != nil {
			if _, known := knownEventIDs[id]; known {
				continue
			}
		}
		return node, true
	}
	return apiCorporateAction{}, false
}

func caTypeFromString(value string) (uint8, bool) {
	switch value {
	case "CashDividend":
		return caCashDividend, true
	case "ForwardSplit":
		return caForwardSplit, true
	case "ReverseSplit":
		return caReverseSplit, true
	case "StockDividend":
		return caStockDividend, true
	case "SpinOff":
		return caSpinOff, true
	default:
		return 0, false
	}
}

func parseEffectiveTimestamp(value string) (int64, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, value)
		if err != nil {
			return 0, fmt.Errorf("parse effectiveTimeUtc %q: %w", value, err)
		}
	}
	return parsed.Unix(), nil
}

func parseOptionalMultiplier(value *string) (uint64, error) {
	if value == nil {
		return 0, nil
	}
	return parseMultiplier(*value)
}

func hashEventID(eventID string) [16]byte {
	sum := sha1.Sum([]byte(eventID))
	var out [16]byte
	copy(out[:], sum[:16])
	return out
}

func formatSyncResult(payload SyncPayload, payloadBytes []byte) *SyncResult {
	return &SyncResult{
		Symbol:        "",
		Mint:          payload.Mint.String(),
		EventCount:    len(payload.Events),
		InsertedCount: len(payload.Events),
		PayloadBase64: encodeBase64(payloadBytes),
	}
}

func encodeBase64(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func jsonDecode(body []byte, out any) error {
	return json.Unmarshal(body, out)
}
