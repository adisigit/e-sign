package chaincode

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"
)

var privateDocumentAllowedFields = map[string]struct{}{
	"collection":           {},
	"documentID":           {},
	"documentCategoryCode": {},
	"name":                 {},
	"description":          {},
	"file":                 {},
	"recipients":           {},
	"timestamp":            {},
}

var privateDocumentRequiredFields = map[string]struct{}{
	"collection":           {},
	"documentID":           {},
	"documentCategoryCode": {},
	"name":                 {},
	"description":          {},
	"file":                 {},
	"recipients":           {},
	"timestamp":            {},
}

func validateJSONObjectFields(
	rawJSON []byte,
	allowedFields map[string]struct{},
	requiredFields map[string]struct{},
) error {
	decoder := json.NewDecoder(bytes.NewReader(rawJSON))

	firstToken, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("failed to read JSON: %w", err)
	}

	openingDelimiter, ok := firstToken.(json.Delim)
	if !ok || openingDelimiter != '{' {
		return fmt.Errorf("private document must be a JSON object")
	}

	seenFields := make(map[string]struct{})

	for decoder.More() {
		fieldToken, err := decoder.Token()
		if err != nil {
			return fmt.Errorf("failed to read JSON field: %w", err)
		}

		fieldName, ok := fieldToken.(string)
		if !ok {
			return fmt.Errorf("invalid JSON field name")
		}

		if _, exists := seenFields[fieldName]; exists {
			return fmt.Errorf(
				"duplicate JSON field detected: %s",
				fieldName,
			)
		}

		if _, allowed := allowedFields[fieldName]; !allowed {
			return fmt.Errorf(
				"unknown JSON field detected: %s",
				fieldName,
			)
		}

		var rawValue json.RawMessage

		if err := decoder.Decode(&rawValue); err != nil {
			return fmt.Errorf(
				"failed to decode field %s: %w",
				fieldName,
				err,
			)
		}

		if bytes.Equal(
			bytes.TrimSpace(rawValue),
			[]byte("null"),
		) {
			return fmt.Errorf(
				"field %s cannot be null",
				fieldName,
			)
		}

		seenFields[fieldName] = struct{}{}
	}

	closingToken, err := decoder.Token()
	if err != nil {
		return fmt.Errorf(
			"failed to read JSON closing delimiter: %w",
			err,
		)
	}

	closingDelimiter, ok := closingToken.(json.Delim)
	if !ok || closingDelimiter != '}' {
		return fmt.Errorf("invalid JSON object termination")
	}

	var trailingValue interface{}

	err = decoder.Decode(&trailingValue)
	if err != io.EOF {
		if err == nil {
			return fmt.Errorf(
				"unexpected JSON value after private document",
			)
		}

		return fmt.Errorf(
			"invalid trailing JSON content: %w",
			err,
		)
	}

	for requiredField := range requiredFields {
		if _, exists := seenFields[requiredField]; !exists {
			return fmt.Errorf(
				"required JSON field is missing: %s",
				requiredField,
			)
		}
	}

	return nil
}

func decodePrivateDocumentStrict(
	rawJSON []byte,
	expectedCollection string,
	expectedDocumentID string,
) (*PrivateDocumentWebhook, error) {
	if err := validateJSONObjectFields(
		rawJSON,
		privateDocumentAllowedFields,
		privateDocumentRequiredFields,
	); err != nil {
		return nil, err
	}

	decoder := json.NewDecoder(bytes.NewReader(rawJSON))
	decoder.DisallowUnknownFields()

	var document PrivateDocumentWebhook

	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf(
			"failed to decode private document: %w",
			err,
		)
	}

	if document.Collection != expectedCollection {
		return nil, fmt.Errorf(
			"collection mismatch: expected %s, got %s",
			expectedCollection,
			document.Collection,
		)
	}

	if document.ID != expectedDocumentID {
		return nil, fmt.Errorf(
			"documentID mismatch: expected %s, got %s",
			expectedDocumentID,
			document.ID,
		)
	}

	if len(document.File) != sha256.Size*2 {
		return nil, fmt.Errorf(
			"invalid document hash length: expected %d hex characters, got %d",
			sha256.Size*2,
			len(document.File),
		)
	}

	if _, err := hex.DecodeString(document.File); err != nil {
		return nil, fmt.Errorf(
			"document hash is not valid hexadecimal: %w",
			err,
		)
	}

	if document.Timestamp == "" {
		return nil, fmt.Errorf("timestamp cannot be empty")
	}

	if _, err := time.Parse(time.RFC3339, document.Timestamp); err != nil {
		return nil, fmt.Errorf(
			"timestamp is not valid RFC3339: %w",
			err,
		)
	}

	return &document, nil
}

func decodePrivateDocumentRaw(rawJSON []byte) (*PrivateDocumentWebhook, error) {
	var generic map[string]interface{}
	if err := json.Unmarshal(rawJSON, &generic); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	getString := func(key string) string {
		if v, ok := generic[key].(string); ok {
			return v
		}
		return ""
	}

	return &PrivateDocumentWebhook{
		Collection:           getString("collection"),
		ID:                   getString("documentID"),
		DocumentCategoryCode: getString("documentCategoryCode"),
		Name:                 getString("name"),
		Description:          getString("description"),
		File:                 getString("file"),
		Timestamp:            getString("timestamp"),
	}, nil
}

var privateLogAllowedFields = map[string]struct{}{
	"collectionLog":     {},
	"logID":             {},
	"documentID":        {},
	"userID":            {},
	"name":              {},
	"userRoleCode":      {},
	"recipientRoleCode": {},
	"timestamp":         {},
}

var privateLogRequiredFields = map[string]struct{}{
	"collectionLog":     {},
	"logID":             {},
	"documentID":        {},
	"userID":            {},
	"name":              {},
	"userRoleCode":      {},
	"recipientRoleCode": {},
	"timestamp":         {},
}

func decodePrivateLogStrict(
	rawJSON []byte,
	expectedCollectionLog string,
	expectedLogID string,
	expectedDocumentID string,
) (*PrivateLogDocumentWebhook, error) {
	if err := validateJSONObjectFields(
		rawJSON,
		privateLogAllowedFields,
		privateLogRequiredFields,
	); err != nil {
		return nil, fmt.Errorf(
			"private log schema validation failed: %w",
			err,
		)
	}

	decoder := json.NewDecoder(bytes.NewReader(rawJSON))
	decoder.DisallowUnknownFields()

	var logRecord PrivateLogDocumentWebhook

	if err := decoder.Decode(&logRecord); err != nil {
		return nil, fmt.Errorf(
			"failed to decode private log: %w",
			err,
		)
	}

	if logRecord.CollectionLog != expectedCollectionLog {
		return nil, fmt.Errorf(
			"collectionLog mismatch: expected %s, got %s",
			expectedCollectionLog,
			logRecord.CollectionLog,
		)
	}

	if logRecord.ID != expectedLogID {
		return nil, fmt.Errorf(
			"logID mismatch: expected %s, got %s",
			expectedLogID,
			logRecord.ID,
		)
	}

	if logRecord.DocumentID != expectedDocumentID {
		return nil, fmt.Errorf(
			"documentID mismatch: expected %s, got %s",
			expectedDocumentID,
			logRecord.DocumentID,
		)
	}

	if logRecord.UserID == "" {
		return nil, fmt.Errorf("userID cannot be empty")
	}

	if logRecord.Name == "" {
		return nil, fmt.Errorf("name cannot be empty")
	}

	if logRecord.UserRoleCode == "" {
		return nil, fmt.Errorf("userRoleCode cannot be empty")
	}

	if logRecord.RecipientRoleCode == "" {
		return nil, fmt.Errorf(
			"recipientRoleCode cannot be empty",
		)
	}

	if logRecord.Timestamp == "" {
		return nil, fmt.Errorf("timestamp cannot be empty")
	}

	if _, err := time.Parse(
		time.RFC3339,
		logRecord.Timestamp,
	); err != nil {
		return nil, fmt.Errorf(
			"timestamp is not valid RFC3339: %w",
			err,
		)
	}

	return &logRecord, nil
}
