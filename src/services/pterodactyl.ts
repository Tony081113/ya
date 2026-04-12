import axios, { AxiosInstance } from 'axios';
import { PterodactylServer, PterodactylUser, ServerCreationOptions } from '../types';

export class PterodactylService {
  private client: AxiosInstance;
  private userClient: AxiosInstance | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: `${process.env.PTERODACTYL_URL}/api/application`,
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // 設定使用者專用 API 金鑰以進行操作
  setUserApiKey(apiKey: string): void {
    this.userClient = axios.create({
      baseURL: `${process.env.PTERODACTYL_URL}/api/client`,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // 設定管理員 API 金鑰以進行操作（還原至管理員客戶端）
  setAdminApiKey(): void {
    this.client = axios.create({
      baseURL: `${process.env.PTERODACTYL_URL}/api/application`,
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private getSmartStartupCommand(egg: any): string {
    const eggName = egg.name?.toLowerCase() || '';
    const nestName = egg.nest_name?.toLowerCase() || '';
    
    // 根據 egg 類型智慧選擇預設值
    if (eggName.includes('node') || eggName.includes('nodejs')) {
      return 'node index.js';
    }
    
    if (eggName.includes('python')) {
      return 'python main.py';
    }
    
    if (eggName.includes('java') || eggName.includes('jar')) {
      return 'java -jar server.jar';
    }
    
    if (eggName.includes('go') || eggName.includes('golang')) {
      return './main';
    }
    
    if (eggName.includes('rust')) {
      return './target/release/server';
    }
    
    if (eggName.includes('docker') || eggName.includes('generic')) {
      return './start.sh';
    }
    
    // 通用 AIO（All-in-One）egg — 常見於自訂部署
    if (eggName.includes('aio') || eggName.includes('pterodactyl')) {
      return 'bash';
    }
    
    // 依巢類型的備用預設
    if (nestName.includes('minecraft')) {
      return 'java -Xmx1024M -Xms1024M -jar server.jar nogui';
    }
    
    // 通用備用預設
    return 'echo "Server configured with smart defaults"';
  }

  // 管理員操作（使用管理員 API 金鑰）
  async getUsers(): Promise<PterodactylUser[]> {
    try {
      const response = await this.client.get('/users');
      return response.data.data.map((user: any) => user.attributes);
    } catch (error) {
      throw new Error(`取得使用者列表失敗：${error}`);
    }
  }

  async getUserById(userId: number): Promise<PterodactylUser> {
    try {
      const response = await this.client.get(`/users/${userId}`);
      return response.data.attributes;
    } catch (error) {
      throw new Error(`取得使用者失敗：${error}`);
    }
  }

  async createUser(userData: {
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    password: string;
  }): Promise<PterodactylUser> {
    try {
      const response = await this.client.post('/users', userData);
      return response.data.attributes;
    } catch (error) {
      throw new Error(`建立使用者失敗：${error}`);
    }
  }

  async getNodes(): Promise<any[]> {
    try {
      const response = await this.client.get('/nodes');      // 過濾掉未定義或不完整的節點
      const nodes = response.data.data
        .map((node: any) => node.attributes)
        .filter((node: any) => node && node.id && node.name);
      
      return nodes;
    } catch (error) {
      console.error('取得節點列表失敗：', error);
      throw new Error(`取得節點列表失敗：${error}`);
    }
  }

  async getNodeAllocations(nodeId: number): Promise<any[]> {
    try {
      const response = await this.client.get(`/nodes/${nodeId}/allocations`);
      return response.data.data;
    } catch (error) {
      console.error(`取得節點 ${nodeId} 的配置失敗：`, error);
      throw new Error(`取得配置失敗：${error}`);
    }
  }

  async getEggs(): Promise<any[]> {
    try {
      // 先取得所有巢
      const nestsResponse = await this.client.get('/nests');
      const nests = nestsResponse.data.data;
      
      const allEggs: any[] = [];
      
      // 取得每個巢的 egg，包含其變數定義
      for (const nest of nests) {
        try {
          const eggsResponse = await this.client.get(`/nests/${nest.attributes.id}/eggs?include=variables`);
          const eggs = eggsResponse.data.data.map((egg: any) => ({
            ...egg.attributes,
            nest_name: nest.attributes.name,
            nest_id: nest.attributes.id,
            variables: egg.attributes?.relationships?.variables?.data?.map((v: any) => v.attributes) || []
          }));
          allEggs.push(...eggs);
        } catch (error) {
          console.warn(`取得來自 ${nest.attributes.name} 巢的 egg 失敗：`, error);
        }
      }
        // 過濾掉未定義或不完整的 egg
      const validEggs = allEggs.filter(egg => egg && egg.id && egg.name);
      
      return validEggs;
    } catch (error) {
      throw new Error(`取得 egg 列表失敗：${error}`);
    }
  }

  async createServer(options: ServerCreationOptions & { user: number }): Promise<PterodactylServer> {
    try {
      // 取得所選 egg 的詳細資訊以正確設定
      const eggs = await this.getEggs();
      const selectedEgg = eggs.find(egg => egg.id === options.egg);
      
      if (!selectedEgg) {
        throw new Error(`找不到 ID 為 ${options.egg} 的 egg`);
      }

      // 從 egg 變數預設值建立環境變數
      const eggEnvDefaults: Record<string, string> = {};
      if (Array.isArray(selectedEgg.variables)) {
        for (const variable of selectedEgg.variables) {
          if (variable.env_variable) {
            eggEnvDefaults[variable.env_variable] = variable.default_value ?? '';
          }
        }
      }

      // 依 Pterodactyl API 規格建立伺服器的基本請求酬載
      const serverData = {
        name: options.name,
        description: options.description || '',
        user: options.user,
        egg: options.egg,
        docker_image: selectedEgg.docker_image || 'ghcr.io/pterodactyl/yolks:java_17',
        startup: selectedEgg.startup || 'echo "Starting server..."',
        limits: {
          memory: options.memory,
          swap: 0,
          disk: options.disk,
          io: 500,
          cpu: options.cpu,
        },
        feature_limits: {
          databases: 0,
          backups: 1,
          allocations: 1,
        },
        deploy: {
          locations: [options.location || 1],
          dedicated_ip: false,
          port_range: [],
        },
        environment: {
          // 使用 egg 的變數預設值作為基底
          ...eggEnvDefaults,
          
          // 針對含有 {{STARTUP_CMD}} 佔位符的 egg 套用智慧預設
          ...(selectedEgg.startup?.includes('{{STARTUP_CMD}}') && {
            STARTUP_CMD: this.getSmartStartupCommand(selectedEgg)
          }),
          
          // 新增 Paper 專用變數
          ...(selectedEgg.name?.toLowerCase().includes('paper') && {
            SERVER_JARFILE: 'server.jar',
            BUILD_NUMBER: 'latest'
          }),
          
          // 新增 Minecraft 專用變數
          ...(selectedEgg.nest_name?.toLowerCase().includes('minecraft') && !selectedEgg.name?.toLowerCase().includes('paper') && {
            SERVER_JARFILE: 'server.jar'
          })
        }
      };      const response = await this.client.post('/servers', serverData);
      return response.data.attributes;
    } catch (error: any) {
      console.error('伺服器建立失敗：', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });

      if (error.response?.status === 422) {
        const validationErrors = error.response?.data?.errors;
        
        if (validationErrors) {
          if (Array.isArray(validationErrors)) {
            const errorMessages = validationErrors.map((err, index) => {
              if (typeof err === 'object' && err.detail) {
                return err.detail;
              }
              return `錯誤 ${index + 1}：${JSON.stringify(err)}`;
            }).join('; ');
            throw new Error(`驗證失敗：${errorMessages}`);
          } else {
            const errorMessages = Object.entries(validationErrors)
              .map(([field, messages]: [string, any]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
              .join('; ');
            throw new Error(`驗證失敗：${errorMessages}`);
          }
        }
        throw new Error('伺服器建立失敗：提供的資料無效');
      }
      
      throw new Error(`建立伺服器失敗：${error.response?.statusText || error.message}`);
    }
  }

  // 使用者操作（使用使用者專用 API 金鑰）
  async getClientUserInfo(): Promise<any> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      const response = await this.userClient.get('/account');
      
      if (response.data?.attributes) {
        return response.data.attributes;
      } else if (response.data) {
        return response.data;
      } else {
        throw new Error('Pterodactyl API 回應結構異常');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('API 金鑰無效 — 提供的 API 金鑰不正確或已被撤銷。');
      } else if (error.response?.status === 404) {
        throw new Error('找不到 API 端點 — 請確認您的 Pterodactyl 面板網址。');
      } else if (error.response?.status === 403) {
        throw new Error('存取被拒 — API 金鑰可能沒有足夠的權限');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('連線被拒 — 無法連線至 Pterodactyl 面板。');
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('找不到網域 — Pterodactyl 面板網址似乎無效');
      }
      
      throw new Error(`取得使用者資訊失敗：${error.response?.status} ${error.response?.statusText || error.message}`);
    }
  }
  async getUserServers(): Promise<PterodactylServer[]> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      const response = await this.userClient.get('/');
      const servers = response.data.data.map((server: any) => server.attributes);
      
      // 為每台伺服器取得額外詳細資訊以獲得狀態
      const detailedServers = await Promise.all(
        servers.map(async (server: any) => {
          try {
            const resourceResponse = await this.userClient!.get(`/servers/${server.identifier}/resources`);
            const resourceData = resourceResponse.data.attributes;
            
            return {
              ...server,
              status: resourceData.current_state || 'offline'
            };
          } catch (error) {
            console.error(`取得伺服器 ${server.identifier} 狀態失敗：`, error);
            return {
              ...server,
              status: 'unknown'
            };
          }
        })
      );
      
      return detailedServers;
    } catch (error) {
      throw new Error(`取得使用者伺服器失敗：${error}`);
    }
  }

  async getServerDetails(serverId: string): Promise<PterodactylServer> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      const response = await this.userClient.get(`/servers/${serverId}`);
      return response.data.attributes;
    } catch (error) {
      throw new Error(`取得伺服器詳細資訊失敗：${error}`);
    }
  }
  async deleteServer(serverIdentifier: string): Promise<void> {
    try {
      // 先嘗試取得所有伺服器，以 UUID 找到目標伺服器
      const servers = await this.getAllServers();
      const server = servers.find(s => s.uuid === serverIdentifier || s.id?.toString() === serverIdentifier);
      
      if (!server) {
        throw new Error(`找不到識別碼為 ${serverIdentifier} 的伺服器`);
      }
        // 使用內部伺服器 ID 進行刪除（Pterodactyl 管理員 API 要求內部 ID）
      await this.client.delete(`/servers/${server.id}`);
      
    } catch (error) {
      console.error('伺服器刪除錯誤：', error);
      throw new Error(`刪除伺服器失敗：${error}`);
    }
  }

  async createAllocation(nodeId: number, ip: string, ports: string[]): Promise<void> {
    try {
      await this.client.post(`/nodes/${nodeId}/allocations`, { ip, ports });
    } catch (error: any) {
      const detail = error.response?.data?.errors?.[0]?.detail || error.response?.statusText || error.message;
      throw new Error(`建立配置失敗：${detail}`);
    }
  }

  async deleteAllocation(nodeId: number, allocationId: number): Promise<void> {
    try {
      await this.client.delete(`/nodes/${nodeId}/allocations/${allocationId}`);
    } catch (error: any) {
      const detail = error.response?.data?.errors?.[0]?.detail || error.response?.statusText || error.message;
      throw new Error(`刪除配置失敗：${detail}`);
    }
  }

  async getAllServers(): Promise<any[]> {
    try {
      const response = await this.client.get('/servers');
      return response.data.data.map((server: any) => server.attributes);
    } catch (error) {
      throw new Error(`取得所有伺服器失敗：${error}`);
    }
  }

  async suspendServer(serverId: string): Promise<void> {
    try {
      await this.client.post(`/servers/${serverId}/suspend`);
    } catch (error) {
      throw new Error(`暫停伺服器失敗：${error}`);
    }
  }

  async unsuspendServer(serverId: string): Promise<void> {
    try {
      await this.client.post(`/servers/${serverId}/unsuspend`);
    } catch (error) {
      throw new Error(`解除暫停伺服器失敗：${error}`);
    }
  }

  async sendPowerAction(serverId: string, action: 'start' | 'stop' | 'restart' | 'kill'): Promise<void> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      await this.userClient.post(`/servers/${serverId}/power`, { signal: action });
    } catch (error) {
      throw new Error(`發送電源指令失敗：${error}`);
    }
  }

  async userOwnsServer(serverId: string): Promise<boolean> {
    if (!this.userClient) {
      return false;
    }

    try {
      const userServers = await this.getUserServers();
      return userServers.some(server => server.uuid === serverId || server.id?.toString() === serverId);
    } catch (error) {
      console.error('檢查伺服器所有權時發生錯誤：', error);
      return false;
    }
  }

  async getUserServerById(serverId: string): Promise<PterodactylServer | null> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      const userServers = await this.getUserServers();
      const server = userServers.find(s => s.uuid === serverId || s.id?.toString() === serverId);
      
      if (!server) {
        return null;
      }      return server;
    } catch (error) {
      throw new Error(`取得伺服器失敗：${error}`);
    }
  }  async getServerResourceUsage(serverId: string): Promise<any> {
    if (!this.userClient) {
      throw new Error('尚未設定使用者 API 金鑰');
    }

    try {
      const response = await this.userClient.get(`/servers/${serverId}/resources`);
      return response.data.attributes;
    } catch (error) {
      throw new Error(`取得伺服器資源使用狀況失敗：${error}`);
    }
  }
}
