package main

import (
	"testing"
	"time"
)

func TestEffectiveLockNonces(t *testing.T) {
	if got := effectiveLockNonces(&Config{}); got != 2 {
		t.Fatalf("default lockNonces: got %d want 2", got)
	}
	if got := effectiveLockNonces(&Config{LockNonces: 3}); got != 3 {
		t.Fatalf("explicit lockNonces: got %d want 3", got)
	}
}

func TestCaTypeToKind(t *testing.T) {
	if kind, ok := caTypeToKind("CashDividend"); !ok || kind != 0 {
		t.Fatalf("CashDividend: got kind=%d ok=%v", kind, ok)
	}
	if kind, ok := caTypeToKind("StockDividend"); !ok || kind != 0 {
		t.Fatalf("StockDividend: got kind=%d ok=%v", kind, ok)
	}
	if kind, ok := caTypeToKind("ForwardSplit"); !ok || kind != 1 {
		t.Fatalf("ForwardSplit: got kind=%d ok=%v", kind, ok)
	}
	if kind, ok := caTypeToKind("ReverseSplit"); !ok || kind != 1 {
		t.Fatalf("ReverseSplit: got kind=%d ok=%v", kind, ok)
	}
	if kind, ok := caTypeToKind("SpinOff"); !ok || kind != 2 {
		t.Fatalf("SpinOff: got kind=%d ok=%v", kind, ok)
	}
	if _, ok := caTypeToKind("Unknown"); ok {
		t.Fatal("Unknown should not map")
	}
}

func TestSelectOldestWritable(t *testing.T) {
	oldMult := "1.0"
	newMult := "1.1"
	newerMult := "1.2"

	nodes := []apiCorporateAction{
		{
			EventID:          "newer",
			CaType:           "CashDividend",
			EffectiveTimeUTC: time.Unix(200, 0).UTC().Format(time.RFC3339),
			MultiplierOld:    &newMult,
			MultiplierNew:    &newerMult,
		},
		{
			EventID:          "older",
			CaType:           "CashDividend",
			EffectiveTimeUTC: time.Unix(100, 0).UTC().Format(time.RFC3339),
			MultiplierOld:    &oldMult,
			MultiplierNew:    &newMult,
		},
	}

	got, ok := selectOldestWritable(nodes, nil)
	if !ok || got.EventID != "older" {
		t.Fatalf("expected oldest writable, got ok=%v id=%q", ok, got.EventID)
	}

	known := map[[16]byte]struct{}{
		hashEventID("older"): {},
	}
	got, ok = selectOldestWritable(nodes, known)
	if !ok || got.EventID != "newer" {
		t.Fatalf("expected newer after older known, got ok=%v id=%q", ok, got.EventID)
	}

	incompleteOld := "0.9"
	incomplete := []apiCorporateAction{
		{
			EventID:          "no-new",
			CaType:           "CashDividend",
			EffectiveTimeUTC: time.Unix(50, 0).UTC().Format(time.RFC3339),
			MultiplierOld:    &incompleteOld,
			MultiplierNew:    nil,
		},
		nodes[1],
	}
	got, ok = selectOldestWritable(incomplete, nil)
	if !ok || got.EventID != "older" {
		t.Fatalf("expected skip incomplete, got ok=%v id=%q", ok, got.EventID)
	}
}
