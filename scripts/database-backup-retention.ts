import { processCliArguments } from "../src/infrastructure/db/maintenance/cli-arguments";
import { runRetentionCli } from "../src/infrastructure/db/maintenance/retention-cli";

void runRetentionCli(processCliArguments(process.argv.slice(2))).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
);
