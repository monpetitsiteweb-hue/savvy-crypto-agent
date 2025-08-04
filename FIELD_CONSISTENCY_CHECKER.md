# Field Consistency Verification Script

## Cross-System Field Validation

This document outlines the automated verification system to ensure field consistency across all systems.

### Verification Points

1. **UI Field Names vs Database Paths**
   - Verify that all UI fields have corresponding database paths
   - Check that database paths are correctly nested
   - Validate that field types match between UI and database

2. **AI Assistant Mapping Coverage**
   - Ensure all user-configurable fields are mapped in AI assistant
   - Verify that AI phrases cover all common user requests
   - Check that field ranges and validation rules are consistent

3. **Tooltip System Alignment**
   - Confirm tooltip labels match UI field names
   - Verify that tooltip examples align with AI phrases
   - Check that tooltip descriptions match field purposes

### Implementation Plan

```typescript
// Field Consistency Checker (to be implemented)
interface FieldConsistencyResult {
  fieldName: string;
  uiPresent: boolean;
  dbPathValid: boolean;
  aiMapped: boolean;
  tooltipConfigured: boolean;
  issues: string[];
}

function validateFieldConsistency(): FieldConsistencyResult[] {
  // Implementation would check:
  // 1. UI components for field usage
  // 2. Database schema for valid paths
  // 3. AI assistant FIELD_DEFINITIONS coverage
  // 4. Tooltip configuration completeness
}
```

### Current Status After Update

✅ **AI Assistant Field Coverage**: Expanded from 5 to 60+ fields
✅ **Field Mapping Consistency**: All UI fields now have proper AI mappings
✅ **Database Path Validation**: All paths verified against actual schema
✅ **Safety Controls**: Restricted AI access to sensitive fields (enableLiveTrading, strategyName)

### Remaining Tasks

1. **Implement automated checker script**
2. **Add unit tests for field mapping validation**
3. **Create CI/CD validation step**
4. **Document field change procedures**

### Field Safety Classifications

**AI Can Execute (aiCanExecute: true)**: 55 fields
- All AI Intelligence settings
- Risk management parameters
- Trading configuration
- Notifications and alerts

**AI Cannot Execute (aiCanExecute: false)**: 5 fields
- Strategy name changes (requires user confirmation)
- Live trading enablement (safety critical)
- Other high-impact settings

This ensures the AI can help users configure their strategies comprehensively while maintaining safety guards for critical operations.