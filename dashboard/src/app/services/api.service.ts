import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

export interface HealthResponse {
  database: { connected: boolean };
  ollama: { running: boolean; modelsAvailable?: number; error?: string };
  configuration?: { guildId?: string; selected_model?: string; active_policy_pack_id?: number };
}

export interface PolicyPack {
  id: number;
  name: string;
  description?: string;
  is_active: boolean;
}

export interface BotConfig {
  guild_id: string;
  mod_log_channel_id?: string;
  selected_model?: string;
  active_policy_pack_id?: number;
  ollama_host?: string;
  is_enabled?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getHealth(guildId?: string): Observable<HealthResponse> {
    const params = guildId ? new HttpParams().set('guildId', guildId) : undefined;
    return this.http.get<HealthResponse>(`${this.baseUrl}/api/health`, { params });
  }

  getConfig(guildId?: string): Observable<BotConfig> {
    const params = guildId ? new HttpParams().set('guildId', guildId) : undefined;
    return this.http.get<BotConfig>(`${this.baseUrl}/api/config`, { params });
  }

  updateConfig(config: Partial<BotConfig> & { guild_id?: string }): Observable<BotConfig> {
    return this.http.post<BotConfig>(`${this.baseUrl}/api/config`, config);
  }

  getPolicyPacks(): Observable<PolicyPack[]> {
    return this.http.get<PolicyPack[]>(`${this.baseUrl}/api/policy-packs`);
  }

  getModels(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/api/models`);
  }
}
