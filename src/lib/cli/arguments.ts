export function parseFlags(args: string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}.`);
    flags.set(token.slice(2), value);
    index += 1;
  }
  return {
    required(name: string) {
      const value = flags.get(name);
      if (!value) throw new Error(`Missing required --${name} argument.`);
      return value;
    },
    optional(name: string) {
      return flags.get(name);
    },
  };
}
