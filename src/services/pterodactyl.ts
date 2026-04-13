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

  // 設定使用者專用 API 金鑰以執行操作
  setUserApiKey(apiKey: string): void {
    this.userClient = axios.create({
      baseURL: `${process.env.PTERODACTYL_URL}/api/client`,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // 設定管理員 API 金鑰（切換回管理員客戶端）
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
    
    // 根據 Egg 類型智慧選擇預設值
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
    
    // 通用 AIO（All-in-One）Egg - 常用於自訂部署
    if (eggName.includes('aio') || eggName.includes('pterodactyl')) {
      return 'bash';
    }
    
    // 根據 Nest 類型使用後備預設值
    if (nestName.includes('minecraft')) {
      return 'java -Xmx1024M -Xms1024M -jar server.jar nogui';
    }
    
    // 通用後備預設值
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
      const response = await this.client.get('/nodes');      // 過濾未定義或不完整的節點
      const nodes = response.data.data
        .map((node: any) => node.attributes)
        .filter((node: any) => node && node.id && node.name);
      
      return nodes;
    } catch (error) {
      console.error('取得節點列表失敗：', error);
      throw new Error(`取得節點列表失敗：${error}`);
    }
  }

  /** 取得指定節點中第一個未被使用的 Allocation，若無可用 Port 則拋出錯誤 */
  async getFirstAvailableAllocation(nodeId: number): Promise<{ id: number; port: number }> {
    try {
      const response = await this.client.get(`/nodes/${nodeId}/allocations`);
      const allocations: any[] = response.data.data;
      const available = allocations.find((a: any) => a.attributes.assigned === false);

      if (!available) {
        throw new Error(`節點 ${nodeId} 已無可用的 Port，請選擇其他節點或釋放現有 Allocation。`);
      }

      return {
        id: available.attributes.id,
        port: available.attributes.port,
      };
    } catch (error: any) {
      if (error.message?.includes('節點')) {
        throw error;
      }
      throw new Error(`無法取得節點 ${nodeId} 的 Allocation：${error.message || error}`);
    }
  }

  async getNodeAllocations(nodeId: number): Promise<any[]> {
    try {
      const response = await this.client.get(`/nodes/${nodeId}/allocations`);
      return response.data.data;
    } catch (error) {
      console.error(`取得節點 ${nodeId} 的配置清單失敗：`, error);
      throw new Error(`取得配置清單失敗：${error}`);
    }
  }

  async getEggs(): Promise<any[]> {
    try {
      // 首先取得所有 Nest
      const nestsResponse = await this.client.get('/nests');
      const nests = nestsResponse.data.data;
      
      const allEggs: any[] = [];
      
      // 取得各 Nest 的 Egg
      for (const nest of nests) {
        try {
          const eggsResponse = await this.client.get(`/nests/${nest.attributes.id}/eggs`);
          const eggs = eggsResponse.data.data.map((egg: any) => ({
            ...egg.attributes,
            nest_name: nest.attributes.name,
            nest_id: nest.attributes.id
          }));
          allEggs.push(...eggs);
        } catch (error) {
          console.warn(`取得 Nest ${nest.attributes.name} 的 Egg 清單失敗：`, error);
        }
      }
        // 過濾未定義或不完整的 Egg
      const validEggs = allEggs.filter(egg => egg && egg.id && egg.name);
      
      return validEggs;
    } catch (error) {
      throw new Error(`取得 Egg 清單失敗：${error}`);
    }
  }

  /** 取得單一 Egg 的詳細資訊（不含變數）*/
  async getEgg(nestId: number, eggId: number): Promise<any> {
    try {
      const response = await this.client.get(`/nests/${nestId}/eggs/${eggId}`);
      return response.data.attributes;
    } catch (error) {
      throw new Error(`取得 Egg 詳細資訊失敗：${error}`);
    }
  }

  /** 在所有 Nest 中尋找指定 Egg ID，回傳 egg 物件（含 nest_id / nest_name）*/
  async findEggById(eggId: number): Promise<any | null> {
    try {
      const eggs = await this.getEggs();
      return eggs.find((e: any) => e.id === eggId) ?? null;
    } catch {
      return null;
    }
  }

  async createServer(options: ServerCreationOptions & { user: number }): Promise<PterodactylServer> {
    try {
      // 優先採用 .env 中設定的強制值，否則使用 options 的傳入值
      const forcedNestId = process.env.PTERO_NEST_ID ? parseInt(process.env.PTERO_NEST_ID, 10) : undefined;
      const forcedEggId  = process.env.PTERO_EGG_ID  ? parseInt(process.env.PTERO_EGG_ID,  10) : undefined;

      const nestId = forcedNestId ?? options.nestId;
      const eggId  = forcedEggId  ?? options.eggId;

      if (!nestId || !eggId) {
        throw new Error('未指定 Egg：請在指令中選擇一個 Egg，或在 .env 設定 PTERO_NEST_ID / PTERO_EGG_ID。');
      }

      // 1. 先取得該節點第一個可用的 Allocation（同時拿到 Port 號碼）
      const allocation = await this.getFirstAvailableAllocation(options.nodeId);

      // 2. 取得 Egg 詳細資訊（含 docker_image、startup 指令與環境變數預設值）
      const eggResponse = await this.client.get(
        `/nests/${nestId}/eggs/${eggId}?include=variables`
      );
      const egg = eggResponse.data.attributes;

      // 3. 從 Egg 的變數定義中取出預設值，作為 environment 的基底
      //    避免因漏填 required 欄位而被 Pterodactyl 拒絕（422）
      const eggVariables: any[] = egg.relationships?.variables?.data ?? [];
      const baseEnvironment: Record<string, string> = {};
      for (const v of eggVariables) {
        const attr = v.attributes ?? v;
        const key = attr.env_variable ?? attr.name;
        if (key) {
          baseEnvironment[key] = attr.default_value ?? '';
        }
      }

      // 4. 組裝建立伺服器所需的 Payload
      //    將自訂覆蓋值合併到 Egg 預設值之上，確保所有 required 欄位都存在
      const serverData = {
        name: options.name,
        description: options.description || '',
        user: options.user,
        egg: eggId,
        docker_image: egg.docker_image || 'ghcr.io/pterodactyl/yolks:python_3_11',
        startup: egg.startup || 'pip install -r requirements.txt && python bot.py',
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
        // 使用指定的 Allocation 而非由面板自動分配
        allocation: {
          default: allocation.id,
        },
        environment: {
          // Egg 預設值（涵蓋所有 required 欄位）
          ...baseEnvironment,
          // 自訂覆蓋值
          STARTUP_CMD: 'pip install -r requirements.txt',
          SECOND_CMD: 'python bot.py',
          QUERY_PORT: allocation.port.toString(),
        },
      };

      const response = await this.client.post('/servers', serverData);
      return response.data.attributes;
    } catch (error: any) {
      // 若是我們自己拋出的業務錯誤（如無可用 Port），直接向上傳遞
      if (!error.response) {
        throw error;
      }

      console.error('建立伺服器失敗：', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });

      if (error.response?.status === 422) {
        const validationErrors = error.response?.data?.errors;

        if (validationErrors) {
          if (Array.isArray(validationErrors)) {
            const errorMessages = validationErrors
              .map((err: any, index: number) => {
                if (typeof err === 'object' && err.detail) {
                  return err.detail;
                }
                return `錯誤 ${index + 1}：${JSON.stringify(err)}`;
              })
              .join('；');
            throw new Error(`資料驗證失敗：${errorMessages}`);
          } else {
            const errorMessages = Object.entries(validationErrors)
              .map(
                ([field, messages]: [string, any]) =>
                  `${field}：${Array.isArray(messages) ? messages.join('、') : messages}`
              )
              .join('；');
            throw new Error(`資料驗證失敗：${errorMessages}`);
          }
        }
        throw new Error('建立伺服器失敗：提供的資料無效');
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
        throw new Error('API 金鑰無效 - 提供的 API 金鑰無效或已被撤銷。');
      } else if (error.response?.status === 404) {
        throw new Error('找不到 API 端點 - 請確認您的 Pterodactyl 面板網址是否正確。');
      } else if (error.response?.status === 403) {
        throw new Error('存取遭拒 - API 金鑰可能沒有足夠的權限。');
      } else if (error.code === 'ECONNREFUSED') {
        throw new Error('連線被拒絕 - 無法連線至 Pterodactyl 面板。');
      } else if (error.code === 'ENOTFOUND') {
        throw new Error('找不到網域 - Pterodactyl 面板網址似乎無效。');
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
      
      // 取得每個伺服器的詳細資訊以得知其狀態
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
      throw new Error(`取得使用者伺服器列表失敗：${error}`);
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
      // 先取得所有伺服器，以 UUID 找到目標伺服器
      const servers = await this.getAllServers();
      const server = servers.find(s => s.uuid === serverIdentifier || s.id?.toString() === serverIdentifier);
      
      if (!server) {
        throw new Error(`找不到識別碼為 ${serverIdentifier} 的伺服器`);
      }
        // 使用內部伺服器 ID 進行刪除（Pterodactyl 管理員 API 需要內部 ID）
      await this.client.delete(`/servers/${server.id}`);
      
    } catch (error) {
      console.error('刪除伺服器時發生錯誤：', error);
      throw new Error(`刪除伺服器失敗：${error}`);
    }
  }

  async getAllServers(): Promise<any[]> {
    try {
      const response = await this.client.get('/servers');
      return response.data.data.map((server: any) => server.attributes);
    } catch (error) {
      throw new Error(`取得所有伺服器列表失敗：${error}`);
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
      throw new Error(`傳送電源指令失敗：${error}`);
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
      console.error('確認伺服器所有權時發生錯誤：', error);
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
}
