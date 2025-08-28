// default = silent everywhere
export const Toast = {
  success: (_: string) => {},
  error:   (_: string) => {},
  info:    (_: string) => {},
  warn:    (_: string) => {},
};
Object.freeze(Toast);