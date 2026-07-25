import { runRestoreCli } from "../src/infrastructure/db/maintenance/maintenance-cli";
import { processCliArguments } from "../src/infrastructure/db/maintenance/cli-arguments";

void runRestoreCli(processCliArguments(process.argv.slice(2))).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
);
