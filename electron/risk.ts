import type { PortRow } from '../shared/types'

/**
 * Classifies what stopping a listener would actually cost.
 *
 * Killing Vite and killing Postgres should not look identical. Vite loses
 * nothing you cannot get back in two seconds; Postgres may lose writes that were
 * still in flight. The confirm dialog says which one you are about to do.
 *
 * Everything here is derived from data the scan already has — process name,
 * port, resolved project, protocol, uptime — so classification costs nothing.
 */

export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface StopRisk {
  level: RiskLevel
  /** Short chip text for the confirm line. */
  label: string
  /** Longer sentence for the tooltip. */
  detail: string
}

/** Datastores: stopping these can lose data that was not yet flushed. */
const DATASTORE_PROCESS =
  /^(postgres|postmaster|mysqld|mariadbd|redis-server|mongod|memcached|elasticsearch|clickhouse|influxd|etcd|cockroach)/i

/**
 * Ports whose default owner is a datastore. Deliberately excludes ambiguous
 * ones: 7000 is Cassandra, but on a Mac it is far more often AirPlay Receiver.
 */
const DATASTORE_PORTS = new Set([
  1433, 3306, 5432, 5433, 6379, 8529, 9042, 9200, 11211, 27017, 27018, 27019,
])

/** Runtimes a dev server actually runs under. */
const DEV_RUNTIME =
  /^(node|bun|deno|ruby|puma|rails|python[\d.]*|php|java|dotnet|air|cargo|vite|next|nodemon|gunicorn|uvicorn|rackup|foreman|overmind)/i

/** Beyond this, "dev server" is a poor description of something. */
const LONG_RUNNING_SECONDS = 7 * 24 * 60 * 60

export function assessStopRisk(
  row: Pick<
    PortRow,
    'process' | 'port' | 'protocol' | 'projectPath' | 'uptimeSeconds' | 'cwd' | 'variant'
  >,
): StopRisk {
  const process = row.process ?? ''

  // The process name is the strongest signal, so it is checked before anything
  // a port number might merely imply.
  if (DATASTORE_PROCESS.test(process)) {
    return {
      level: 'danger',
      label: 'database',
      detail:
        'This looks like a datastore. Stopping it can lose writes that have not been flushed to disk.',
    }
  }

  // No resolvable project directory means this is not something you started in a
  // repo — a system daemon, a helper, or an editor's language server. Checked
  // before the port heuristic so a system process on a datastore port is not
  // mislabelled as a database.
  if (!row.projectPath || row.cwd === '/' || row.variant === 'permission') {
    return {
      level: 'caution',
      label: 'system process',
      detail:
        'No project directory resolved, so this is probably a system or application daemon rather than a dev server. Something else may depend on it.',
    }
  }

  if (DATASTORE_PORTS.has(row.port)) {
    return {
      level: 'danger',
      label: 'database',
      detail: `Port ${row.port} is a datastore's default. Stopping it can lose unflushed writes.`,
    }
  }

  const servesHttp = row.protocol === 'http' || row.protocol === 'https'

  if (servesHttp && DEV_RUNTIME.test(process)) {
    if (row.uptimeSeconds > LONG_RUNNING_SECONDS) {
      return {
        level: 'caution',
        label: 'long-running',
        detail:
          'Serves HTTP from a project directory, but it has been up for over a week, which is unusual for a dev server.',
      }
    }
    return {
      level: 'safe',
      label: 'dev server',
      detail: 'Serves HTTP from a project directory under a development runtime. Safe to stop.',
    }
  }

  return {
    level: 'caution',
    label: servesHttp ? 'unrecognised server' : 'non-HTTP service',
    detail: servesHttp
      ? 'Serves HTTP from a project directory, but not under a runtime recognised as a dev server.'
      : 'Does not answer HTTP, so it is some other kind of service. Check what depends on it before stopping.',
  }
}
