import * as c from "ansi-colors";
import * as fs from "fs-extra";
import * as yaml from "js-yaml";
import * as yargs from "yargs";

import { Parser } from "./parser";

// Array polyfill
declare global {
    // tslint:disable-next-line:interface-name
    interface Array<T> {
        first(): T | undefined;
        last(): T | undefined;
    }
}
Array.prototype.last = function() {
    return this[this.length - 1];
};
Array.prototype.first = function() {
    return this[0];
};

const argv = yargs.argv;
const cwd = String(argv.cwd || process.cwd());
const m: any = argv.m;
const manualArgs: string[] = [].concat(m || []);

const firstArg = argv._[0] ?? "pipeline";

if (firstArg === "manual") {
    for (let i = 1; i < argv._.length; i += 1) {
        manualArgs.push(argv._[i]);
    }
}

const parser = new Parser(cwd);

const runJobs = async () => {
    const jobs = Array.from(parser.getJobs().values());
    const stages = Array.from(parser.getStages().values());

    let stage = stages.shift();
    while (stage !== undefined) {
        const jobsInStage = stage.getJobs();
        const stageName = stage.name;

        if (!stage.isRunning()) {
            console.log(`=> ${c.yellow(`${stageName}`)} <=`);
            if (jobsInStage.length === 0 && !stage.isRunning()) {
                console.log(`=> ${c.yellow(`${stageName}`)} has no jobs`);
            }
        }

        for (const job of jobsInStage) {
            if (job.isManual() && !manualArgs.includes(job.name) && !job.isFinished()) {
                console.log(`${job.getJobNameString()} ${c.magentaBright("skipped")} when:manual`);
                job.setFinished(true);
                continue;
            }

            if (job.isNever() && !job.isFinished()) {
                console.log(`${job.getJobNameString()} ${c.magentaBright("skipped")} when:never`);
                job.setFinished(true);
                continue;
            }

            if (!job.isRunning() && !job.isFinished()) {
                /* tslint:disable */
                // noinspection ES6MissingAwait
                job.start();
                /* tslint:enabled */
            }
        }

        // Find jobs that can be started, because their needed jobs have finished
        for (const job of jobs) {
            if (job.isRunning() || job.isFinished() || job.needs.length === 0) {
                continue;
            }

            const finishedJobNames = jobs.filter((e) => e.isFinished()).map((j) => j.name);
            const needsConditionMet = job.needs.every((v) => (finishedJobNames.indexOf(v) >= 0));
            if (needsConditionMet) {
                /* tslint:disable */
                // noinspection ES6MissingAwait
                job.start();
                /* tslint:enabled */
            }
        }

        await new Promise((r) => setTimeout(r, 50));

        if (stage.isFinished()) {
            if (!stage.isSuccess()) {
                process.exit(2);
            }
            console.log("");
            stage = stages.shift();
        }
    }

};

const runExecJobs = async () => {
    const jobs = [];
    for (let i = 1; i < argv._.length; i += 1) {
        const jobName = argv._[i];
        const job = parser.getJobs().get(argv._[i]);
        if (!job) {
            console.error(`${c.blueBright(`${jobName}`)} ${c.red(" could not be found")}`);
            process.exit(1);
        }

        jobs.push(job);

        /* tslint:disable */
        // noinspection ES6MissingAwait
        job.start();
        /* tslint:enabled */
    }

    while (jobs.filter((j) => j.isRunning()).length > 0) {
        await new Promise((r) => setTimeout(r, 50));
    }

    if (jobs.filter((j) => j.isSuccess()).length !== jobs.length) {
        process.exit(2);
    }
};

process.on("uncaughtException", (err) => {
    // Handle the error safely
    console.log(err);
    process.exit(5);
});

// Ensure gitlab-ci-local working directory and assets.
const pipelinesStatePath = `${cwd}/.gitlab-ci-local/state.yml`;
fs.ensureFileSync(pipelinesStatePath);
let pipelinesState: any = yaml.safeLoad(fs.readFileSync(pipelinesStatePath, "utf8"));
if (!pipelinesState) {
    pipelinesState = {};
}
pipelinesState.pipelineId = pipelinesState.pipelineId !== undefined ? Number(pipelinesState.pipelineId) : 0;
if (["pipeline", "manual"].includes(firstArg)) {
    pipelinesState.pipelineId += 1;
}
fs.writeFileSync(pipelinesStatePath, yaml.safeDump(pipelinesState), {});
process.env.CI_PIPELINE_ID = pipelinesState.pipelineId;

if (["pipeline", "manual"].includes(firstArg)) {
    // noinspection JSIgnoredPromiseFromCall
    runJobs();
} else if (firstArg === "exec") {
    // noinspection JSIgnoredPromiseFromCall
    runExecJobs();
}
