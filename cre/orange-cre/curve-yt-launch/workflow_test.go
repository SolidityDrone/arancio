package main

import (
	"encoding/json"
	"testing"

	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
)

func TestOnLaunchRequestPolicyOnly(t *testing.T) {
	cfg := &Config{DefaultFairCoupon: 0.02, RefNotionalUsd: 100}
	payload, _ := json.Marshal(LaunchRequest{
		Mint:        "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
		Symbol:      "KOx",
		StartNonce:  0,
		TargetNonce: 2,
		FairCoupon:  0.02,
	})

	result, err := onLaunchRequest(cfg, nil, &http.Payload{Input: payload})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK {
		t.Fatalf("expected ok without executor")
	}
	if result.LaunchFairPpm != 20_000 {
		t.Fatalf("ppm=%d want 20000", result.LaunchFairPpm)
	}
	if result.TotalTokenSupply != 2_000_000 {
		t.Fatalf("supply=%d want 2000000", result.TotalTokenSupply)
	}
}

func TestOnLaunchRequestRejectsBadWindow(t *testing.T) {
	cfg := &Config{}
	payload, _ := json.Marshal(LaunchRequest{
		Mint:        "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
		StartNonce:  3,
		TargetNonce: 3,
	})
	_, err := onLaunchRequest(cfg, nil, &http.Payload{Input: payload})
	if err == nil {
		t.Fatal("expected error for equal nonces")
	}
}
