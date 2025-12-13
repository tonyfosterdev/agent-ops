import { AppDataSource } from '../database.js';
import { Session, type SessionStatus } from '../entities/Session.js';

export interface SessionFilters {
  status?: SessionStatus;
  agentType?: string;
  limit?: number;
  offset?: number;
}

export class SessionService {
  private repository = AppDataSource.getRepository(Session);

  async createSession(agentType: string, title?: string): Promise<string> {
    const session = this.repository.create({
      agent_type: agentType,
      title,
      status: 'active',
    });
    const saved = await this.repository.save(session);
    return saved.id;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.repository.findOne({
      where: { id: sessionId },
      relations: ['runs'],
    });
  }

  async listSessions(filters: SessionFilters = {}): Promise<Session[]> {
    const { status, agentType, limit = 50, offset = 0 } = filters;

    const query = this.repository
      .createQueryBuilder('session')
      .orderBy('session.updated_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (status) {
      query.andWhere('session.status = :status', { status });
    }
    if (agentType) {
      query.andWhere('session.agent_type = :agentType', { agentType });
    }

    return query.getMany();
  }

  async archiveSession(sessionId: string): Promise<void> {
    await this.repository.update(sessionId, { status: 'archived' });
  }

  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await this.repository.update(sessionId, { updated_at: new Date() });
  }
}
