import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandlerInput = {
  req: IncomingMessage;
  res: ServerResponse;
  requestUrl: URL;
};

export type RouteHandler = (input: RouteHandlerInput) => boolean;
