import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

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
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
      return;
    }

    req[source] = value;
    next();
  };
}
