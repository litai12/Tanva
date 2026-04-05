import 'dotenv/config';
import { initOpenTelemetry } from './telemetry/tracing';
import { installUpstreamFetchLogger } from './telemetry/upstream-fetch-logger';

initOpenTelemetry();
installUpstreamFetchLogger();
