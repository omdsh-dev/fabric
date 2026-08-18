#!/usr/bin/env node
import { main } from './fabric-dsh/main.mjs'

await main({ launcherUrl: import.meta.url })
