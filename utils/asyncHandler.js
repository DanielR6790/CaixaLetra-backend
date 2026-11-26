// Permite usar async/await nas rotas sem repetir try/catch.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);