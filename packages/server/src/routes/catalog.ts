import { Router, Request, Response } from 'express';
import { success, error } from '../utils/response';
import * as catalogService from '../services/service-catalog.service';

export const catalogRouter = Router();

// No authentication required for catalog routes

// GET /api/v1/catalog/:businessSlug — Browse services
catalogRouter.get('/:businessSlug', async (req: Request, res: Response) => {
  try {
    const filters = {
      categoryId: req.query.category_id as string,
      minPrice: req.query.min_price ? parseInt(req.query.min_price as string, 10) : undefined,
      maxPrice: req.query.max_price ? parseInt(req.query.max_price as string, 10) : undefined,
      minDuration: req.query.min_duration ? parseInt(req.query.min_duration as string, 10) : undefined,
      maxDuration: req.query.max_duration ? parseInt(req.query.max_duration as string, 10) : undefined,
      search: req.query.search as string,
    };

    const catalog = await catalogService.getCatalog(req.params.businessSlug, filters);
    if (!catalog) { error(res, 'Business not found', 'NOT_FOUND', 404); return; }

    success(res, catalog);
  } catch (err: any) {
    error(res, 'Failed to load catalog', 'INTERNAL_ERROR', 500);
  }
});

// GET /api/v1/catalog/:businessSlug/:serviceSlug — Service detail
catalogRouter.get('/:businessSlug/:serviceSlug', async (req: Request, res: Response) => {
  try {
    const detail = await catalogService.getCatalogServiceDetail(req.params.businessSlug, req.params.serviceSlug);
    if (!detail) { error(res, 'Service not found', 'NOT_FOUND', 404); return; }

    success(res, detail);
  } catch (err: any) {
    error(res, 'Failed to load service detail', 'INTERNAL_ERROR', 500);
  }
});
