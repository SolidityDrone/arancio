package main

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/cre"
)

type Config struct {
	ChainSelector     uint64  `json:"chainSelector,string"`
	TxExecutorURL     string  `json:"txExecutorUrl"`
	RefNotionalUsd    float64 `json:"refNotionalUsd"`
	DefaultFairCoupon float64 `json:"defaultFairCoupon"`
}

// LaunchRequest is the HTTP trigger payload (frontend → backend → CRE).
type LaunchRequest struct {
	Mint        string  `json:"mint"`
	Symbol      string  `json:"symbol"`
	StartNonce  uint32  `json:"startNonce"`
	TargetNonce uint32  `json:"targetNonce"`
	FairCoupon  float64 `json:"fairCoupon"`
}

type TxExecutorPayload struct {
	Mint                  string  `json:"mint"`
	Symbol                string  `json:"symbol"`
	StartNonce            uint32  `json:"startNonce"`
	TargetNonce           uint32  `json:"targetNonce"`
	LockNonces            uint32  `json:"lockNonces"`
	TotalTokenSupply      uint64  `json:"totalTokenSupply"`
	InitialMarketCapUsd   uint64  `json:"initialMarketCapUsd"`
	MigrationMarketCapUsd uint64  `json:"migrationMarketCapUsd"`
	LaunchFairPpm         uint32  `json:"launchFairPpm"`
	FairCoupon            float64 `json:"fairCoupon"`
}

type TxExecutorReply struct {
	OK                bool   `json:"ok"`
	Pool              string `json:"pool"`
	BaseMint          string `json:"baseMint"`
	QuoteMint         string `json:"quoteMint"`
	Config            string `json:"config"`
	LaunchSignature   string `json:"launchSignature"`
	RegisterSignature string `json:"registerSignature"`
	Error             string `json:"error"`
}

type LaunchResult struct {
	OK                    bool    `json:"ok"`
	Mint                  string  `json:"mint"`
	Symbol                string  `json:"symbol"`
	StartNonce            uint32  `json:"startNonce"`
	TargetNonce           uint32  `json:"targetNonce"`
	TotalTokenSupply      uint64  `json:"totalTokenSupply"`
	InitialMarketCapUsd   uint64  `json:"initialMarketCapUsd"`
	MigrationMarketCapUsd uint64  `json:"migrationMarketCapUsd"`
	LaunchFairPpm         uint32  `json:"launchFairPpm"`
	FairCoupon            float64 `json:"fairCoupon"`
	Pool                  string  `json:"pool,omitempty"`
	BaseMint              string  `json:"baseMint,omitempty"`
	QuoteMint             string  `json:"quoteMint,omitempty"`
	Config                string  `json:"config,omitempty"`
	LaunchSignature       string  `json:"launchSignature,omitempty"`
	RegisterSignature     string  `json:"registerSignature,omitempty"`
	ExecutorStatus        string  `json:"executorStatus,omitempty"`
}

func InitWorkflow(config *Config, logger *slog.Logger, secretsProvider cre.SecretsProvider) (cre.Workflow[*Config], error) {
	// Empty authorized keys — local simulate allows unsigned POSTs to port 2000.
	trigger := http.Trigger(&http.Config{})
	return cre.Workflow[*Config]{
		cre.Handler(trigger, onLaunchRequest),
	}, nil
}

func onLaunchRequest(
	config *Config,
	runtime cre.Runtime,
	trigger *http.Payload,
) (*LaunchResult, error) {
	var req LaunchRequest
	if err := json.Unmarshal(trigger.Input, &req); err != nil {
		return nil, fmt.Errorf("decode launch request: %w", err)
	}
	if req.Mint == "" {
		return nil, fmt.Errorf("mint is required")
	}
	if req.TargetNonce <= req.StartNonce {
		return nil, fmt.Errorf("targetNonce must exceed startNonce")
	}

	lock := req.TargetNonce - req.StartNonce
	fair := req.FairCoupon
	if fair <= 0 {
		fair = config.DefaultFairCoupon
	}
	if fair <= 0 {
		fair = 0.02
	}

	policy := computeCurvePolicy(CurvePolicyInput{
		FairCoupon:     fair,
		LockNonces:     lock,
		RefNotionalUsd: config.RefNotionalUsd,
	})

	if runtime != nil {
		runtime.Logger().Info(
			"curve-yt launch request",
			"mint", req.Mint,
			"symbol", req.Symbol,
			"start", req.StartNonce,
			"target", req.TargetNonce,
			"supply", policy.TotalTokenSupply,
			"initialMcap", policy.InitialMarketCapUsd,
		)
	}

	result := &LaunchResult{
		Mint:                  req.Mint,
		Symbol:                req.Symbol,
		StartNonce:            req.StartNonce,
		TargetNonce:           req.TargetNonce,
		TotalTokenSupply:      policy.TotalTokenSupply,
		InitialMarketCapUsd:   policy.InitialMarketCapUsd,
		MigrationMarketCapUsd: policy.MigrationMarketCapUsd,
		LaunchFairPpm:         policy.LaunchFairPpm,
		FairCoupon:            fair,
	}

	if config.TxExecutorURL == "" {
		result.ExecutorStatus = "skipped (no txExecutorUrl)"
		result.OK = true
		return result, nil
	}

	body, err := json.Marshal(TxExecutorPayload{
		Mint:                  req.Mint,
		Symbol:                req.Symbol,
		StartNonce:            req.StartNonce,
		TargetNonce:           req.TargetNonce,
		LockNonces:            lock,
		TotalTokenSupply:      policy.TotalTokenSupply,
		InitialMarketCapUsd:   policy.InitialMarketCapUsd,
		MigrationMarketCapUsd: policy.MigrationMarketCapUsd,
		LaunchFairPpm:         policy.LaunchFairPpm,
		FairCoupon:            fair,
	})
	if err != nil {
		return nil, err
	}

	client := &http.Client{}
	promise := http.SendRequest(
		config,
		runtime,
		client,
		func(_ *Config, _ *slog.Logger, sendRequester *http.SendRequester) (string, error) {
			resp, err := sendRequester.SendRequest(&http.Request{
				Method: "POST",
				Url:    config.TxExecutorURL,
				Body:   body,
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
			}).Await()
			if err != nil {
				return "", err
			}
			return string(resp.Body), nil
		},
		cre.ConsensusIdenticalAggregation[string](),
	)

	executorBody, err := promise.Await()
	if err != nil {
		result.ExecutorStatus = fmt.Sprintf("executor error: %v", err)
		return result, nil
	}
	result.ExecutorStatus = executorBody

	var exec TxExecutorReply
	if err := json.Unmarshal([]byte(executorBody), &exec); err != nil {
		return result, nil
	}
	result.OK = exec.OK
	result.Pool = exec.Pool
	result.BaseMint = exec.BaseMint
	result.QuoteMint = exec.QuoteMint
	result.Config = exec.Config
	result.LaunchSignature = exec.LaunchSignature
	result.RegisterSignature = exec.RegisterSignature
	if !exec.OK && exec.Error != "" {
		result.ExecutorStatus = exec.Error
	}
	return result, nil
}
