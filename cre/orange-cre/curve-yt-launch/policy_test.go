package main

import "testing"

func TestComputeCurvePolicyStripShaped(t *testing.T) {
	p := computeCurvePolicy(CurvePolicyInput{
		FairCoupon: 0.02,
		LockNonces: 7,
	})
	if p.TotalTokenSupply != 7_000_000 {
		t.Fatalf("supply=%d want 7M", p.TotalTokenSupply)
	}
	if p.InitialMarketCapUsd < 5_000 {
		t.Fatalf("initial mcap too low: %d", p.InitialMarketCapUsd)
	}
	if p.LaunchFairPpm != 20_000 {
		t.Fatalf("ppm=%d want 20000", p.LaunchFairPpm)
	}
}
