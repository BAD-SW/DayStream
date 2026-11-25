import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { msg, hasMessage, requestLanguageCode } from '../i18n';

/** A field's name for messages: its translation (errors:fields.<name>) when there is one, else as sent. */
function fieldName(d: Joi.ValidationErrorItem): string {
  const name = String(d.context?.key ?? d.path[d.path.length - 1] ?? '');
  return hasMessage(`errors:fields.${name}`) ? msg(`errors:fields.${name}`) : name;
}

/**
 * One validation problem in the request's language (Phase 44, design section 6.3): built from Joi's
 * error type and the field, so schemas need no text of their own. English keeps Joi's own wording,
 * as before; another language uses errors:validation.<type> when it exists.
 */
function problemMessage(d: Joi.ValidationErrorItem): string {
  const key = `errors:validation.${d.type}`;
  if (requestLanguageCode() === 'en' || !hasMessage(key)) return d.message;
  const limit = d.context?.limit;
  return msg(key, { field: fieldName(d), limit: typeof limit === 'number' || typeof limit === 'string' ? limit : undefined });
}

/**
 * Request validation middleware using Joi schemas.
 * Validates the specified source (body, query, or params).
 * Strips unknown fields and returns structured error details.
 */
export function validate(schema: Joi.ObjectSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      res.status(400).json({
        error: requestLanguageCode() === 'en' ? 'Validation failed' : msg('errors:validation'),
        code: 'VALIDATION_ERROR',
        details: error.details.map((d) => ({
          field: d.path.join('.'),
          message: problemMessage(d),
        })),
      });
      return;
    }

    req[source] = value;
    next();
  };
}
