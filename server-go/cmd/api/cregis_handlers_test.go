package main

import (
	"strings"
	"testing"
)

func TestSingleAdministratorWithdrawalStateTransitions(t *testing.T) {
	tests := []struct {
		name       string
		sql        string
		required   []string
		prohibited []string
	}{
		{
			name:       "approve preserves submitted state gate",
			sql:        approveWithdrawalSQL,
			required:   []string{"status='approved'", "status='submitted'", "checker_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
		{
			name:       "reject preserves submitted state gate",
			sql:        rejectWithdrawalSQL,
			required:   []string{"status='rejected'", "status='submitted'", "checker_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
		{
			name:       "execute requires an explicit approval",
			sql:        startWithdrawalExecutionSQL,
			required:   []string{"status='executing'", "status='approved'", "checker_id IS NOT NULL", "operator_id=?"},
			prohibited: []string{"maker_id<>", "checker_id<>"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, required := range test.required {
				if !strings.Contains(test.sql, required) {
					t.Fatalf("SQL must contain %q: %s", required, test.sql)
				}
			}
			for _, prohibited := range test.prohibited {
				if strings.Contains(test.sql, prohibited) {
					t.Fatalf("SQL must allow one administrator; found %q: %s", prohibited, test.sql)
				}
			}
		})
	}
}
