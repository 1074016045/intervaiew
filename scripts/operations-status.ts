import { processCliArguments } from "../src/infrastructure/db/maintenance/cli-arguments";
import { runOperationsStatusCli } from "../src/infrastructure/db/maintenance/operations-status-cli";

void runOperationsStatusCli(processCliArguments(process.argv.slice(2))).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
);
