// Types
export type { Tenant } from './types/tenant';
export type { Business } from './types/business';
export type { User, UserRole, Persona } from './types/user';
export type { ApiResponse, ApiError } from './types/api';
export type { ConfigDefinition, FeatureFlag, PaginatedResult } from './types/config';
export type {
  QueryExecuteRequest,
  QueryExecuteResponse,
  ColumnInfo,
  SchemaTable,
  SavedQueryDTO,
  QueryHistoryDTO,
} from './types/query-editor';
export type {
  ContextLevel,
  ActiveContext,
  SwitchableContext,
  ContextSwitchAuditEntry,
  ContextState,
} from './types/context';
export type {
  ReportColumn,
  ReportColumnType,
  ReportColumnAlign,
  ReportRunMeta,
  ReportRunResult,
  ReportSection,
  ReportExportFormat,
} from './reports/types';
export type {
  ThemeScope,
  BuiltInThemeId,
  CfgTheme,
  ThemeListItem,
  ResolvedTheme,
  CreateThemeDto,
  UpdateThemeDto,
  ApplyThemeDto,
  ApplyThemeResponse,
} from './types/theme';
export type {
  DocumentPlaceholder,
  DocumentFieldKey,
  DocumentArtifactType,
  DocumentTableRow,
  DocumentDetailsTable,
} from './documents/catalog';

// Constants
export { USER_ROLES, PERSONAS } from './constants/roles';
export { ERROR_CODES } from './constants/error-codes';
export { CONFIG_KEYS } from './constants/config-keys';
export {
  SUPPORTED_LANGUAGES, SUPPORTED_CURRENCIES, DEFAULT_LANGUAGE, LANGUAGE_DETAILS, LANGUAGE_LABELS, LANGUAGE_OPTIONS,
  isSupportedLanguage, languageFromText, supportedLanguagesText,
} from './constants/supported';
export type { SupportedLanguage, SupportedCurrency } from './constants/supported';
export { COUNTRIES, countryNameToIso2, countryNameToDialCode, iso2ToCountry } from './constants/countries';
export type { CountryInfo } from './constants/countries';
export {
  LIFECYCLE_STAGES, LIFECYCLE_STAGE_LABELS, lifecycleStageLabel,
  PERSON_SOURCE_LABELS, personSourceLabel, PEOPLE_VIEWS,
  LEAD_SOURCE_LABELS, LEAD_SOURCES, DEFAULT_LEAD_STAGES,
} from './constants/people';
export type { LifecycleStageValue } from './constants/people';

// Document branding catalog
export {
  DOCUMENT_ARTIFACT_TYPES,
  getArtifactType,
  isKnownArtifactType,
  DETAILS_TABLE_TOKEN,
} from './documents/catalog';

// Forms (spec 51)
export {
  FORM_ITEM_TYPES,
  validateFormDefinition,
  validateFormAnswers,
  isSignedForm,
  entriesByColumn,
  MAX_FORM_COLUMNS,
  MAX_FORM_OPTIONS,
} from './forms/definition';
export type {
  FormItem,
  FormItemType,
  FormDefinition,
  FormApplies,
  FormAnswer,
  FormValidationIssue,
} from './forms/definition';

// Utilities
export { formatCurrency } from './utils/currency';
export { formatDate, formatDateTime } from './utils/date';
export { generateSlug } from './utils/slug';
