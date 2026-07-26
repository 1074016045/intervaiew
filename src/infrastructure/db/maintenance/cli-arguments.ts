import { maintenanceError } from "./maintenance-error";

type OptionDefinition = Readonly<{
  name: string;
  kind: "value" | "flag";
}>;

export type ParsedArguments = Readonly<Record<string, string | boolean>>;

export function processCliArguments(arguments_: readonly string[]): string[] {
  return arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
}

export function parseStrictArguments(
  arguments_: readonly string[],
  definitions: readonly OptionDefinition[],
): ParsedArguments {
  const allowed = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--") || argument === "--")
      throw maintenanceError(
        "CLI_POSITIONAL_ARGUMENT",
        "Positional arguments are not allowed.",
      );
    if (argument.includes("="))
      throw maintenanceError(
        "CLI_OPTION_SYNTAX",
        "Use a space between an option and its value.",
      );
    const name = argument.slice(2);
    const definition = allowed.get(name);
    if (!definition)
      throw maintenanceError("CLI_UNKNOWN_OPTION", "Unknown command option.");
    if (Object.hasOwn(parsed, name))
      throw maintenanceError(
        "CLI_DUPLICATE_OPTION",
        "Duplicate command option.",
      );
    if (definition.kind === "flag") {
      parsed[name] = true;
      continue;
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw maintenanceError(
        "CLI_OPTION_VALUE_MISSING",
        "Command option value is missing.",
      );
    if (value.length === 0 || value.length > 4_096)
      throw maintenanceError(
        "CLI_OPTION_VALUE_INVALID",
        "Command option value is invalid.",
      );
    parsed[name] = value;
    index += 1;
  }
  return parsed;
}

export function argumentString(
  arguments_: ParsedArguments,
  name: string,
): string | undefined {
  const value = arguments_[name];
  return typeof value === "string" ? value : undefined;
}

export function argumentFlag(
  arguments_: ParsedArguments,
  name: string,
): boolean {
  return arguments_[name] === true;
}
