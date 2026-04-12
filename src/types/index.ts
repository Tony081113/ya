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
  /** 要部署的節點 ID（Allocation 與 Egg 設定由系統自動決定） */
  nodeId: number;
}

export interface CommandContext {
  user: BoundUser;
  isAdmin: boolean;
}
