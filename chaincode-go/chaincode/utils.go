package chaincode

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/gowebpki/jcs"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

func (s *SmartContract) validateDataHash(
	ctx contractapi.TransactionContextInterface,
	collection string,
	key string,
	canonicalValue []byte,
) (bool, error) {
	if len(canonicalValue) == 0 {
		return false, fmt.Errorf(
			"canonical private value is empty: collection=%s key=%s",
			collection,
			key,
		)
	}

	ledgerHash, err := ctx.GetStub().GetPrivateDataHash(
		collection,
		key,
	)
	if err != nil {
		return false, fmt.Errorf(
			"failed to retrieve private-data hash: %w",
			err,
		)
	}

	if len(ledgerHash) == 0 {
		return false, fmt.Errorf(
			"private-data hash not found: collection=%s key=%s",
			collection,
			key,
		)
	}

	calculatedHash := sha256.Sum256(canonicalValue)

	return bytes.Equal(
		calculatedHash[:],
		ledgerHash,
	), nil
}

var negativeZeroPattern = regexp.MustCompile(`^-0(\.0+)?([eE][+-]?[0-9]+)?$`)

func rejectNegativeZero(v interface{}) error {
	switch val := v.(type) {
	case json.Number:
		if negativeZeroPattern.MatchString(val.String()) {
			return fmt.Errorf(
				"negative zero (-0) encountered: rejected per RFC 8785 Errata ID 7920",
			)
		}
	case map[string]interface{}:
		for k, elem := range val {
			if err := rejectNegativeZero(elem); err != nil {
				return fmt.Errorf("key %q: %w", k, err)
			}
		}
	case []interface{}:
		for i, elem := range val {
			if err := rejectNegativeZero(elem); err != nil {
				return fmt.Errorf("index %d: %w", i, err)
			}
		}
	}
	return nil
}

func canonicalizeJSON(rawJSON []byte) ([]byte, error) {
	if len(rawJSON) == 0 {
		return nil, fmt.Errorf("cannot canonicalize empty JSON")
	}

	dec := json.NewDecoder(bytes.NewReader(rawJSON))
	dec.UseNumber()
	var parsed interface{}
	if err := dec.Decode(&parsed); err != nil {
		return nil, fmt.Errorf("failed to parse JSON prior to canonicalization: %w", err)
	}
	if err := rejectNegativeZero(parsed); err != nil {
		return nil, err
	}

	canonicalJSON, err := jcs.Transform(rawJSON)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to canonicalize JSON using RFC 8785: %w",
			err,
		)
	}

	return canonicalJSON, nil
}

func ensureDocumentDoesNotExist(
	ctx contractapi.TransactionContextInterface,
	collection string,
	documentID string,
) error {
	existingHash, err := ctx.GetStub().GetPrivateDataHash(
		collection,
		documentID,
	)
	if err != nil {
		return fmt.Errorf(
			"failed to check existing private record: %w",
			err,
		)
	}

	if len(existingHash) > 0 {
		return fmt.Errorf(
			"document %s is already registered",
			documentID,
		)
	}

	return nil
}
