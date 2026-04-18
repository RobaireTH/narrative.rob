import type {
  Request,
  Response,
} from 'express';

export function createScaffoldController(feature_name: string) {
  return {
    notImplemented(_req: Request, res: Response) {
      res.status(501).json({
        error: {
          code: 'not_implemented',
          message: `${feature_name} routes are scaffolded but not implemented yet.`,
        },
        feature: feature_name,
        request_id: res.locals.request_id,
      });
    },
  };
}
