#!/usr/bin/env node
import { main } from './stent-dsh/main.ts'

await main({ launcherUrl: import.meta.url })
