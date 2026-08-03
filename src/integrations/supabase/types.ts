export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      evolution_instances: {
        Row: {
          api_key: string
          base_url: string
          created_at: string | null
          id: string
          instance_id: string
          is_active: boolean | null
          label: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          api_key: string
          base_url: string
          created_at?: string | null
          id?: string
          instance_id: string
          is_active?: boolean | null
          label: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          api_key?: string
          base_url?: string
          created_at?: string | null
          id?: string
          instance_id?: string
          is_active?: boolean | null
          label?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      evolution_logs: {
        Row: {
          created_at: string | null
          event_type: string
          id: number
          instance_id: string
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: number
          instance_id: string
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: number
          instance_id?: string
          payload?: Json | null
        }
        Relationships: []
      }
      evolution_status: {
        Row: {
          instance_id: string
          is_connected: boolean | null
          last_heartbeat: string | null
          last_status: Json | null
          updated_at: string | null
        }
        Insert: {
          instance_id: string
          is_connected?: boolean | null
          last_heartbeat?: string | null
          last_status?: Json | null
          updated_at?: string | null
        }
        Update: {
          instance_id?: string
          is_connected?: boolean | null
          last_heartbeat?: string | null
          last_status?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      fontes: {
        Row: {
          created_at: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          created_at: string
          email: string | null
          fonte_id: string | null
          id: string
          nome: string
          observacoes: string | null
          status: string
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          fonte_id?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          fonte_id?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          status?: string
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_fonte_id_fkey"
            columns: ["fonte_id"]
            isOneToOne: false
            referencedRelation: "fontes"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          conteudo: string
          created_at: string
          id: string
          lead_id: string
          status: string | null
          tipo: string
          user_id: string
        }
        Insert: {
          conteudo: string
          created_at?: string
          id?: string
          lead_id: string
          status?: string | null
          tipo: string
          user_id: string
        }
        Update: {
          conteudo?: string
          created_at?: string
          id?: string
          lead_id?: string
          status?: string | null
          tipo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      midias: {
        Row: {
          created_at: string
          id: string
          mensagem_id: string
          nome_arquivo: string | null
          tamanho: number | null
          tipo: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mensagem_id: string
          nome_arquivo?: string | null
          tamanho?: number | null
          tipo: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mensagem_id?: string
          nome_arquivo?: string | null
          tamanho?: number | null
          tipo?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "midias_mensagem_id_fkey"
            columns: ["mensagem_id"]
            isOneToOne: false
            referencedRelation: "mensagens"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          nome: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          client_name: string
          created_at: string | null
          due_date: string | null
          has_documents: boolean | null
          id: string
          is_completed: boolean | null
          process_number: string | null
          task_type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          client_name: string
          created_at?: string | null
          due_date?: string | null
          has_documents?: boolean | null
          id?: string
          is_completed?: boolean | null
          process_number?: string | null
          task_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          client_name?: string
          created_at?: string | null
          due_date?: string | null
          has_documents?: boolean | null
          id?: string
          is_completed?: boolean | null
          process_number?: string | null
          task_type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wpp_contacts: {
        Row: {
          blacklist: boolean | null
          created_at: string | null
          id: string
          instance_id: string | null
          last_message_at: string | null
          name: string | null
          phone: string
          tags: string[] | null
        }
        Insert: {
          blacklist?: boolean | null
          created_at?: string | null
          id?: string
          instance_id?: string | null
          last_message_at?: string | null
          name?: string | null
          phone: string
          tags?: string[] | null
        }
        Update: {
          blacklist?: boolean | null
          created_at?: string | null
          id?: string
          instance_id?: string | null
          last_message_at?: string | null
          name?: string | null
          phone?: string
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "wpp_contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wpp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wpp_conversations: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          created_at: string | null
          id: string
          instance_id: string | null
          status: string
          unread_count: number | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          instance_id?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string
          instance_id?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wpp_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wpp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wpp_conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wpp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wpp_instance_members: {
        Row: {
          created_at: string | null
          id: string
          instance_id: string | null
          role: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          instance_id?: string | null
          role: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instance_id?: string | null
          role?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wpp_instance_members_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wpp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wpp_instances: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          last_event: Json | null
          last_qr: string | null
          name: string
          phone: string | null
          session_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          last_event?: Json | null
          last_qr?: string | null
          name: string
          phone?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          last_event?: Json | null
          last_qr?: string | null
          name?: string
          phone?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      wpp_logs: {
        Row: {
          created_at: string | null
          id: number
          instance_id: string | null
          level: string
          message: string | null
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          level: string
          message?: string | null
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: number
          instance_id?: string | null
          level?: string
          message?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "wpp_logs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wpp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      wpp_messages: {
        Row: {
          content: string | null
          conversation_id: string | null
          created_at: string | null
          direction: string
          id: string
          instance_id: string | null
          meta: Json | null
          status: string | null
          type: string
        }
        Insert: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          direction: string
          id?: string
          instance_id?: string | null
          meta?: Json | null
          status?: string | null
          type?: string
        }
        Update: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          direction?: string
          id?: string
          instance_id?: string | null
          meta?: Json | null
          status?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wpp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wpp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wpp_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "wpp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
