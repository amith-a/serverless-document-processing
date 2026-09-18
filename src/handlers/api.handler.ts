import { handle } from 'hono/aws-lambda';
import app from '../api/app.js';

export const handler = handle(app);
