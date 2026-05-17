function sendSuccess(res, data, meta = {}, status = 200) {
  return res.status(status).json({
    success: true,
    data,
    meta,
  });
}

function sendError(res, status, error, meta = {}) {
  return res.status(status).json({
    success: false,
    error,
    meta,
  });
}

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

module.exports = {
  sendSuccess,
  sendError,
  initSse,
};
