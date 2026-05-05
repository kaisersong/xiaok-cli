import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';

type Language = 'zh' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: () => {},
  t: (key: string) => key,
});

const translations: Record<string, { zh: string; en: string }> = {
  // Navigation
  'nav.new_task': { zh: '新建任务', en: 'New task' },
  'nav.scheduled': { zh: '定时任务', en: 'Scheduled' },
  'nav.history': { zh: '历史任务', en: 'History' },
  'nav.no_history': { zh: '暂无历史任务', en: 'No history' },
  'nav.no_results': { zh: '无结果', en: 'No results' },
  'nav.rename': { zh: '重命名', en: 'Rename' },

  // Settings
  'settings.model': { zh: '模型设置', en: 'Models' },
  'settings.skills': { zh: '技能管理', en: 'Skills' },
  'settings.channels': { zh: '消息通道', en: 'Channels' },
  'settings.mcp': { zh: 'MCP 服务器', en: 'MCP Servers' },
  'settings.appearance': { zh: '外观设置', en: 'Appearance' },
  'settings.general': { zh: '通用设置', en: 'General' },
  'settings.data': { zh: '数据管理', en: 'Data' },
  'settings.about': { zh: '关于', en: 'About' },

  // General settings
  'general.language': { zh: '语言', en: 'Language' },
  'general.language.zh': { zh: '中文', en: 'Chinese' },
  'general.language.en': { zh: '英文', en: 'English' },

  // Chat
  'chat.placeholder': { zh: '回复...', en: 'Reply...' },
  'chat.running': { zh: '输入消息...', en: 'Type a message...' },
  'chat.thinking': { zh: '思考中...', en: 'Thinking...' },
  'chat.failed': { zh: '任务失败，请重试。', en: 'Task failed. Please try again.' },
  'chat.disclaimer': { zh: 'Xiaok is AI and can make mistakes.', en: 'Xiaok is AI and can make mistakes.' },

  // Scheduled
  'scheduled.title': { zh: '定时任务', en: 'Scheduled Tasks' },
  'scheduled.subtitle': { zh: '管理按计划运行的自动化任务', en: 'Manage automated tasks that run on a schedule' },
  'scheduled.new': { zh: '新建任务', en: 'New task' },
  'scheduled.no_tasks': { zh: '暂无定时任务', en: 'No scheduled tasks' },
  'scheduled.create_first': { zh: '创建第一个任务', en: 'Create your first task' },
  'scheduled.create_desc': { zh: '创建任务以自动化重复性工作', en: 'Create a task to automate repetitive work' },
  'scheduled.name': { zh: '名称', en: 'Name' },
  'scheduled.description': { zh: '描述', en: 'Description' },
  'scheduled.instructions': { zh: '指令', en: 'Instructions' },
  'scheduled.frequency': { zh: '频率', en: 'Frequency' },
  'scheduled.run': { zh: '运行', en: 'Run' },
  'scheduled.pause': { zh: '暂停', en: 'Pause' },
  'scheduled.resume': { zh: '恢复', en: 'Resume' },
  'scheduled.active': { zh: '活跃', en: 'Active' },
  'scheduled.paused': { zh: '已暂停', en: 'Paused' },
  'scheduled.last_run': { zh: '上次运行', en: 'Last run' },
  'scheduled.cancel': { zh: '取消', en: 'Cancel' },
  'scheduled.save': { zh: '保存', en: 'Save' },
  'scheduled.saving': { zh: '保存中...', en: 'Saving...' },

  // Common
  'common.loading': { zh: '加载中...', en: 'Loading...' },
  'common.back': { zh: '返回', en: 'Back' },
  'common.delete': { zh: '删除', en: 'Delete' },
  'common.edit': { zh: '编辑', en: 'Edit' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.save': { zh: '保存', en: 'Save' },
  'common.test': { zh: '测试', en: 'Test' },
  'common.saving': { zh: '保存中...', en: 'Saving...' },
  'common.about_title': { zh: '关于 xiaok', en: 'About xiaok' },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('xiaok:language');
      return (saved === 'en' || saved === 'zh') ? saved : 'zh';
    } catch {
      return 'zh';
    }
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('xiaok:language', lang);
  };

  const t = (key: string): string => {
    const translation = translations[key];
    if (!translation) return key;
    return translation[language];
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
