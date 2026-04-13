export interface PterodactylServer {
  id: number;
  uuid: string;
  name: string;
  description: string;
  status: string;
  limits: {
    memory: number;
    disk: number;
    cpu: number;
  };
  feature_limits: {
    allocations: number;
    backups: number;
    databases: number;
  };
}

export interface PterodactylUser {
  id: number;
  uuid: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
}

export interface BoundUser {
  id?: number;
  discord_id: string;
  pterodactyl_user_id: number;
  pterodactyl_api_key: string;
  bound_at: string;
}

export interface ServerCreationOptions {
  name: string;
  description?: string;
  memory: number;
  disk: number;
  cpu: number;
  nodeId: number;
  /** 使用者指定的 Nest ID（若 .env 設定 PTERO_NEST_ID 則以 .env 為準） */
  nestId?: number;
  /** 使用者指定的 Egg ID（若 .env 設定 PTERO_EGG_ID 則以 .env 為準） */
  eggId?: number;
}

export interface CommandContext {
  user: BoundUser;
  isAdmin: boolean;
}

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}
