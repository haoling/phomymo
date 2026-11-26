/**
 * Error Handling Utilities
 * Provides consistent error handling across the application
 */

import * as kv from '../kv.js';
import { t } from '../i18n.js';

// Error severity levels
export const ErrorLevel = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

// Store for error handlers
let statusHandler = console.log;
let toastHandler = null;

/**
 * Configure error handlers
 * @param {Object} handlers - { setStatus, showToast }
 */
export function configureErrorHandlers(handlers) {
  if (handlers.setStatus) statusHandler = handlers.setStatus;
  if (handlers.showToast) toastHandler = handlers.showToast;
}

/**
 * Log an error with context
 * @param {Error|string} error - The error or message
 * @param {string} context - Where the error occurred
 * @param {string} level - ErrorLevel value
 */
export function logError(error, context = '', level = ErrorLevel.ERROR) {
  const message = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : null;

  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    stack,
  };

  // Console output based on level
  switch (level) {
    case ErrorLevel.INFO:
      console.info(`[${context}]`, message);
      break;
    case ErrorLevel.WARNING:
      console.warn(`[${context}]`, message);
      break;
    case ErrorLevel.CRITICAL:
      console.error(`[CRITICAL - ${context}]`, message, stack);
      break;
    default:
      console.error(`[${context}]`, message);
  }

  return logEntry;
}

/**
 * Show error to user via status message
 * @param {string} userMessage - User-friendly message
 * @param {Error|string} technicalError - Technical error for logging
 * @param {string} context - Where the error occurred
 */
export function showError(userMessage, technicalError = null, context = '') {
  if (technicalError) {
    logError(technicalError, context);
  }
  statusHandler(userMessage);
}

/**
 * Show error via toast notification
 * @param {string} message - Message to show
 * @param {string} type - 'error', 'warning', 'success', 'info'
 */
export function showToast(message, type = 'error') {
  if (toastHandler) {
    toastHandler(message, type);
  } else {
    console.log(`[Toast - ${type}]`, message);
  }
}

/**
 * Wrap a synchronous function with error handling
 * @param {Function} fn - Function to wrap
 * @param {Object} options - { fallback, errorMessage, context, onError }
 * @returns {Function} Wrapped function
 */
export function safe(fn, options = {}) {
  const {
    fallback = null,
    errorMessage = t('err_operation_failed'),
    context = fn.name || 'anonymous',
    onError = null,
  } = options;

  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      logError(error, context);
      if (onError) onError(error);
      showError(errorMessage, error, context);
      return fallback;
    }
  };
}

/**
 * Wrap an async function with error handling
 * @param {Function} fn - Async function to wrap
 * @param {Object} options - { fallback, errorMessage, context, onError, showStatus }
 * @returns {Function} Wrapped async function
 */
export function safeAsync(fn, options = {}) {
  const {
    fallback = null,
    errorMessage = t('err_operation_failed'),
    context = fn.name || 'anonymous',
    onError = null,
    showStatus = true,
  } = options;

  return async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      logError(error, context);
      if (onError) onError(error);
      if (showStatus) showError(errorMessage, error, context);
      return fallback;
    }
  };
}

/**
 * Execute a function with error handling (inline usage)
 * @param {Function} fn - Function to execute
 * @param {*} fallback - Value to return on error
 * @param {string} context - Error context
 * @returns {*} Result or fallback
 */
export function trySafe(fn, fallback = null, context = '') {
  try {
    return fn();
  } catch (error) {
    logError(error, context, ErrorLevel.WARNING);
    return fallback;
  }
}

/**
 * Execute an async function with error handling (inline usage)
 * @param {Function} fn - Async function to execute
 * @param {*} fallback - Value to return on error
 * @param {string} context - Error context
 * @returns {Promise<*>} Result or fallback
 */
export async function trySafeAsync(fn, fallback = null, context = '') {
  try {
    return await fn();
  } catch (error) {
    logError(error, context, ErrorLevel.WARNING);
    return fallback;
  }
}

/**
 * Safe DOM query that returns null instead of throwing
 * @param {string} selector - CSS selector
 * @param {Element} parent - Parent element (default: document)
 * @returns {Element|null}
 */
export function $(selector, parent = document) {
  try {
    return parent.querySelector(selector);
  } catch (error) {
    logError(error, `DOM query: ${selector}`, ErrorLevel.WARNING);
    return null;
  }
}

/**
 * Safe DOM query all
 * @param {string} selector - CSS selector
 * @param {Element} parent - Parent element (default: document)
 * @returns {NodeList}
 */
export function $$(selector, parent = document) {
  try {
    return parent.querySelectorAll(selector);
  } catch (error) {
    logError(error, `DOM queryAll: ${selector}`, ErrorLevel.WARNING);
    return [];
  }
}

/**
 * Safe JSON parse
 * @param {string} jsonString - JSON string to parse
 * @param {*} fallback - Value to return on error or if input is null/undefined
 * @returns {*} Parsed object or fallback
 */
export function safeJsonParse(jsonString, fallback = null) {
  // Handle null/undefined input (JSON.parse(null) returns null, not an error)
  if (jsonString === null || jsonString === undefined) {
    return fallback;
  }
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    logError(error, 'JSON parse', ErrorLevel.WARNING);
    return fallback;
  }
}

/**
 * Safe JSON stringify
 * @param {*} value - Value to stringify
 * @param {string} fallback - Value to return on error
 * @returns {string} JSON string or fallback
 */
export function safeJsonStringify(value, fallback = '{}') {
  try {
    return JSON.stringify(value);
  } catch (error) {
    logError(error, 'JSON stringify', ErrorLevel.WARNING);
    return fallback;
  }
}

/**
 * Safe storage get (kv.js 経由)
 * @param {string} key - Storage key
 * @param {*} fallback - Value to return on error
 * @returns {string|null} Stored value or fallback
 */
export function safeStorageGet(key, fallback = null) {
  try {
    return kv.getItem(key) ?? fallback;
  } catch (error) {
    logError(error, `storage get: ${key}`, ErrorLevel.WARNING);
    return fallback;
  }
}

/**
 * Safe storage set (kv.js 経由)
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @returns {boolean} Success status
 */
export function safeStorageSet(key, value) {
  try {
    kv.setItem(key, value);
    return true;
  } catch (error) {
    logError(error, `storage set: ${key}`, ErrorLevel.WARNING);
    // Check if it's a quota exceeded error
    if (error.name === 'QuotaExceededError') {
      showError(t('err_storage_full_some'));
    }
    return false;
  }
}

/**
 * Safe storage remove (kv.js 経由)
 * @param {string} key - Storage key
 * @returns {boolean} Success status
 */
export function safeStorageRemove(key) {
  try {
    kv.removeItem(key);
    return true;
  } catch (error) {
    logError(error, `storage remove: ${key}`, ErrorLevel.WARNING);
    return false;
  }
}

/**
 * Validate required parameters
 * @param {Object} params - Parameters to validate
 * @param {string[]} required - Required parameter names
 * @param {string} context - Error context
 * @returns {boolean} True if all required params present
 */
export function validateParams(params, required, context = '') {
  const missing = required.filter(key => params[key] === undefined || params[key] === null);
  if (missing.length > 0) {
    logError(`Missing required parameters: ${missing.join(', ')}`, context, ErrorLevel.WARNING);
    return false;
  }
  return true;
}

/**
 * Create an error with additional context
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {Object} details - Additional details
 * @returns {Error}
 */
export function createError(message, code = 'UNKNOWN', details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

/**
 * Check if an error is of a specific type
 * @param {Error} error - Error to check
 * @param {string} code - Error code to match
 * @returns {boolean}
 */
export function isErrorCode(error, code) {
  return error && error.code === code;
}

/**
 * Error codes for common scenarios
 */
export const ErrorCodes = {
  // Connection errors
  BLE_NOT_SUPPORTED: 'BLE_NOT_SUPPORTED',
  BLE_CONNECTION_FAILED: 'BLE_CONNECTION_FAILED',
  BLE_DEVICE_NOT_FOUND: 'BLE_DEVICE_NOT_FOUND',
  USB_NOT_SUPPORTED: 'USB_NOT_SUPPORTED',
  USB_CONNECTION_FAILED: 'USB_CONNECTION_FAILED',

  // Print errors
  PRINT_FAILED: 'PRINT_FAILED',
  PRINT_NO_DEVICE: 'PRINT_NO_DEVICE',
  PRINT_CANCELLED: 'PRINT_CANCELLED',

  // File errors
  FILE_LOAD_FAILED: 'FILE_LOAD_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_INVALID_TYPE: 'FILE_INVALID_TYPE',

  // Storage errors
  STORAGE_FULL: 'STORAGE_FULL',
  STORAGE_READ_FAILED: 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED: 'STORAGE_WRITE_FAILED',

  // Validation errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',

  // General errors
  UNKNOWN: 'UNKNOWN',
  OPERATION_CANCELLED: 'OPERATION_CANCELLED',
};

/**
 * User-friendly error messages for error codes
 */
/** 値は i18n-messages.js のキー。文言は getErrorMessage() で引く */
export const ErrorMessages = {
  [ErrorCodes.BLE_NOT_SUPPORTED]: 'errmsg_ble_not_supported',
  [ErrorCodes.BLE_CONNECTION_FAILED]: 'errmsg_ble_connection_failed',
  [ErrorCodes.BLE_DEVICE_NOT_FOUND]: 'errmsg_ble_device_not_found',
  [ErrorCodes.USB_NOT_SUPPORTED]: 'errmsg_usb_not_supported',
  [ErrorCodes.USB_CONNECTION_FAILED]: 'errmsg_usb_connection_failed',
  [ErrorCodes.PRINT_FAILED]: 'errmsg_print_failed',
  [ErrorCodes.PRINT_NO_DEVICE]: 'errmsg_print_no_device',
  [ErrorCodes.PRINT_CANCELLED]: 'errmsg_print_cancelled',
  [ErrorCodes.FILE_LOAD_FAILED]: 'errmsg_file_load_failed',
  [ErrorCodes.FILE_TOO_LARGE]: 'errmsg_file_too_large',
  [ErrorCodes.FILE_INVALID_TYPE]: 'errmsg_file_invalid_type',
  [ErrorCodes.STORAGE_FULL]: 'errmsg_storage_full',
  [ErrorCodes.STORAGE_READ_FAILED]: 'errmsg_storage_read_failed',
  [ErrorCodes.STORAGE_WRITE_FAILED]: 'errmsg_storage_write_failed',
  [ErrorCodes.VALIDATION_FAILED]: 'errmsg_validation_failed',
  [ErrorCodes.INVALID_INPUT]: 'errmsg_invalid_input',
  [ErrorCodes.UNKNOWN]: 'errmsg_unknown',
  [ErrorCodes.OPERATION_CANCELLED]: 'errmsg_operation_cancelled',
};

/**
 * Get user-friendly message for an error code
 * @param {string} code - Error code
 * @returns {string} User-friendly message
 */
export function getErrorMessage(code) {
  return t(ErrorMessages[code] || ErrorMessages[ErrorCodes.UNKNOWN]);
}
