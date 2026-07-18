type SafeLog = {
  errorCode?: string;
  route?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
  httpStatus?: number;
  durationMs?: number;
  actionType?: string;
};

export const safeLogger = {
  error(message: string, context: SafeLog) {
    console.error(message, context);
  },
  info(message: string, context: SafeLog) {
    console.info(message, context);
  },
};
