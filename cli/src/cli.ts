#!/usr/bin/env bun
import { runMain } from "citty"
import { mainCommand } from "./command"

await runMain(mainCommand)
