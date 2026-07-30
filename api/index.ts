import serverless from 'serverless-http';
import app from '../src/server';

module.exports = serverless(app);
