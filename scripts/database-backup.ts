import { runBackupCli } from "../src/infrastructure/db/maintenance/maintenance-cli";
import { processCliArguments } from "../src/infrastructure/db/maintenance/cli-arguments";

void runBackupCli(processCliArguments(process.argv.slice(2))).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
);
