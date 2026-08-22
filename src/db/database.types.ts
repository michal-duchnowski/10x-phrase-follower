export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  graphql_public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
  public: {
    Tables: {
      audio_segments: {
        Row: {
          bitrate_kbps: number;
          build_id: string;
          created_at: string;
          duration_ms: number | null;
          error_code: string | null;
          error_details: Json | null;
          id: string;
          is_active: boolean;
          path: string;
          phrase_id: string;
          sample_rate_hz: number;
          size_bytes: number | null;
          status: Database["public"]["Enums"]["audio_status_enum"];
          updated_at: string;
          voice_slot: Database["public"]["Enums"]["voice_slot_enum"];
          word_timings: Json | null;
        };
        Insert: {
          bitrate_kbps?: number;
          build_id: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_details?: Json | null;
          id: string;
          is_active?: boolean;
          path: string;
          phrase_id: string;
          sample_rate_hz?: number;
          size_bytes?: number | null;
          status: Database["public"]["Enums"]["audio_status_enum"];
          updated_at?: string;
          voice_slot: Database["public"]["Enums"]["voice_slot_enum"];
          word_timings?: Json | null;
        };
        Update: {
          bitrate_kbps?: number;
          build_id?: string;
          created_at?: string;
          duration_ms?: number | null;
          error_code?: string | null;
          error_details?: Json | null;
          id?: string;
          is_active?: boolean;
          path?: string;
          phrase_id?: string;
          sample_rate_hz?: number;
          size_bytes?: number | null;
          status?: Database["public"]["Enums"]["audio_status_enum"];
          updated_at?: string;
          voice_slot?: Database["public"]["Enums"]["voice_slot_enum"];
          word_timings?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "audio_segments_build_id_fkey";
            columns: ["build_id"];
            isOneToOne: false;
            referencedRelation: "builds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audio_segments_phrase_id_fkey";
            columns: ["phrase_id"];
            isOneToOne: false;
            referencedRelation: "phrases";
            referencedColumns: ["id"];
          },
        ];
      };
      builds: {
        Row: {
          created_at: string;
          id: string;
          job_id: string;
          notebook_id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          job_id: string;
          notebook_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          job_id?: string;
          notebook_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "builds_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "builds_notebook_id_fkey";
            columns: ["notebook_id"];
            isOneToOne: false;
            referencedRelation: "notebooks";
            referencedColumns: ["id"];
          },
        ];
      };
      import_logs: {
        Row: {
          created_at: string;
          id: string;
          line_no: number;
          notebook_id: string;
          raw_text: string;
          reason: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          line_no: number;
          notebook_id: string;
          raw_text: string;
          reason: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          line_no?: number;
          notebook_id?: string;
          raw_text?: string;
          reason?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_logs_notebook_id_fkey";
            columns: ["notebook_id"];
            isOneToOne: false;
            referencedRelation: "notebooks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "import_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          created_at: string;
          ended_at: string | null;
          error: string | null;
          id: string;
          notebook_id: string;
          started_at: string | null;
          state: Database["public"]["Enums"]["job_state_enum"];
          timeout_sec: number | null;
          type: Database["public"]["Enums"]["job_type_enum"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          ended_at?: string | null;
          error?: string | null;
          id: string;
          notebook_id: string;
          started_at?: string | null;
          state: Database["public"]["Enums"]["job_state_enum"];
          timeout_sec?: number | null;
          type: Database["public"]["Enums"]["job_type_enum"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          ended_at?: string | null;
          error?: string | null;
          id?: string;
          notebook_id?: string;
          started_at?: string | null;
          state?: Database["public"]["Enums"]["job_state_enum"];
          timeout_sec?: number | null;
          type?: Database["public"]["Enums"]["job_type_enum"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "jobs_notebook_id_fkey";
            columns: ["notebook_id"];
            isOneToOne: false;
            referencedRelation: "notebooks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notebooks: {
        Row: {
          created_at: string;
          current_build_id: string | null;
          id: string;
          last_generate_job_id: string | null;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_build_id?: string | null;
          id: string;
          last_generate_job_id?: string | null;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_build_id?: string | null;
          id?: string;
          last_generate_job_id?: string | null;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notebooks_current_build_fk";
            columns: ["current_build_id"];
            isOneToOne: false;
            referencedRelation: "builds";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notebooks_last_generate_job_fk";
            columns: ["last_generate_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notebooks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      phrases: {
        Row: {
          created_at: string;
          difficulty: string | null;
          en_text: string;
          id: string;
          learning_hint_markdown: string | null;
          notebook_id: string;
          pl_text: string;
          position: number;
          tokens: Json | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          difficulty?: string | null;
          en_text: string;
          id: string;
          learning_hint_markdown?: string | null;
          notebook_id: string;
          pl_text: string;
          position: number;
          tokens?: Json | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          difficulty?: string | null;
          en_text?: string;
          id?: string;
          learning_hint_markdown?: string | null;
          notebook_id?: string;
          pl_text?: string;
          position?: number;
          tokens?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "phrases_notebook_id_fkey";
            columns: ["notebook_id"];
            isOneToOne: false;
            referencedRelation: "notebooks";
            referencedColumns: ["id"];
          },
        ];
      };
      story_settings: {
        Row: {
          created_at: string;
          encrypted_api_key: string | null;
          model: string;
          prompt: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          encrypted_api_key?: string | null;
          model?: string;
          prompt?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          encrypted_api_key?: string | null;
          model?: string;
          prompt?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_settings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      tts_credentials: {
        Row: {
          encrypted_key: string;
          is_configured: boolean;
          key_fingerprint: string | null;
          last_validated_at: string | null;
          user_id: string;
        };
        Insert: {
          encrypted_key: string;
          is_configured?: boolean;
          key_fingerprint?: string | null;
          last_validated_at?: string | null;
          user_id: string;
        };
        Update: {
          encrypted_key?: string;
          is_configured?: boolean;
          key_fingerprint?: string | null;
          last_validated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tts_credentials_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_voices: {
        Row: {
          created_at: string;
          id: string;
          language: string;
          slot: Database["public"]["Enums"]["voice_slot_enum"];
          user_id: string;
          voice_id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          language: string;
          slot: Database["public"]["Enums"]["voice_slot_enum"];
          user_id: string;
          voice_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          language?: string;
          slot?: Database["public"]["Enums"]["voice_slot_enum"];
          user_id?: string;
          voice_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_voices_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      citext: {
        Args: { "": boolean } | { "": string } | { "": unknown };
        Returns: string;
      };
      citext_hash: {
        Args: { "": string };
        Returns: number;
      };
      citextin: {
        Args: { "": unknown };
        Returns: string;
      };
      citextout: {
        Args: { "": string };
        Returns: unknown;
      };
      citextrecv: {
        Args: { "": unknown };
        Returns: string;
      };
      citextsend: {
        Args: { "": string };
        Returns: string;
      };
      get_current_user_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: {
      audio_status_enum: "complete" | "failed" | "missing";
      job_state_enum: "queued" | "running" | "succeeded" | "failed" | "canceled" | "timeout";
      job_type_enum: "GENERATE_REBUILD";
      voice_slot_enum: "EN1" | "EN2" | "EN3" | "PL";
    };
    CompositeTypes: Record<never, never>;
  };
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audio_status_enum: ["complete", "failed", "missing"],
      job_state_enum: ["queued", "running", "succeeded", "failed", "canceled", "timeout"],
      job_type_enum: ["GENERATE_REBUILD"],
      voice_slot_enum: ["EN1", "EN2", "EN3", "PL"],
    },
  },
} as const;
