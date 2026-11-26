// Valida body, query e params com schemas do Zod.
// Uso: validate({ query: meuSchema })
// Se a validação falhar, o erro segue para o errorHandler, que devolve
// a mensagem exata do campo com problema (ex.: "Categoria inválida.").
export const validate = (schemas) => (req, res, next) => {
  try {
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.body) req.body = schemas.body.parse(req.body);

    if (schemas.query) {
      const parsed = schemas.query.parse(req.query);
      // Funciona em qualquer versão do Express (em algumas, req.query é somente leitura)
      Object.defineProperty(req, 'query', {
        value: parsed,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};