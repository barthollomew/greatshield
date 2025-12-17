import { Component, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastController } from '@ionic/angular';
import { ApiService, BotConfig, HealthResponse, PolicyPack } from '../services/api.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false
})
export class HomePage implements OnInit {
  loading = false;
  saving = false;
  errorMessage = '';
  guildId = '';
  health?: HealthResponse;
  config?: BotConfig;
  models: string[] = [];
  policyPacks: PolicyPack[] = [];
  selectedModel?: string;
  selectedPolicy?: number;
  modLogChannelId?: string;

  constructor(private api: ApiService, private toast: ToastController) {}

  ngOnInit(): void {
    void this.loadDashboard();
  }

  async refresh(event: CustomEvent): Promise<void> {
    await this.loadDashboard();
    event.detail.complete();
  }

  async loadDashboard(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      const [health, config, policyPacks, models] = await Promise.all([
        firstValueFrom(this.api.getHealth(this.guildId || undefined)),
        firstValueFrom(this.api.getConfig(this.guildId || undefined)),
        firstValueFrom(this.api.getPolicyPacks()),
        firstValueFrom(this.api.getModels())
      ]);

      this.health = health;
      this.config = config;
      this.policyPacks = policyPacks;
      this.models = models;
      this.guildId = config.guild_id;
      this.selectedModel = config.selected_model;
      this.modLogChannelId = config.mod_log_channel_id;
      this.selectedPolicy = config.active_policy_pack_id ?? policyPacks.find((p) => p.is_active)?.id;
    } catch (error) {
      this.errorMessage = this.parseError(error);
      await this.presentToast(this.errorMessage);
    } finally {
      this.loading = false;
    }
  }

  async saveConfig(): Promise<void> {
    if (!this.guildId) {
      await this.presentToast('Add a guild ID before updating settings.');
      return;
    }

    this.saving = true;
    this.errorMessage = '';

    try {
      const payload: Partial<BotConfig> & { guild_id?: string } = {
        guild_id: this.guildId,
        selected_model: this.selectedModel,
        mod_log_channel_id: this.modLogChannelId,
        active_policy_pack_id: this.selectedPolicy
      };

      const updated = await firstValueFrom(this.api.updateConfig(payload));
      this.config = updated;
      await this.presentToast('Configuration saved.');
    } catch (error) {
      this.errorMessage = this.parseError(error);
      await this.presentToast(this.errorMessage);
    } finally {
      this.saving = false;
    }
  }

  badgeColor(ok?: boolean): string {
    if (ok === undefined) {
      return 'medium';
    }
    return ok ? 'success' : 'danger';
  }

  private parseError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Something went wrong while talking to the API.';
  }

  private async presentToast(message: string): Promise<void> {
    const t = await this.toast.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'dark'
    });
    await t.present();
  }
}
