const { readCourseInfo } = require('./courseFiles');

const COURSES = [
  'קורס משא כבד',
  'קורס רכב ציבורי (אוטובוס)',
  'קורס אוטובוס זעיר פרטי',
];

const STATES = {
  NEW:             'new',
  WAITING_NAME:    'waiting_name',
  WAITING_LOCATION:'waiting_location',
  WAITING_PHONE:   'waiting_phone',
  WAITING_COURSE:  'waiting_course',
  WAITING_DETAILS: 'waiting_details',
  DONE:            'done',
};

const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, {
      state: STATES.NEW,
      name: null, location: null, contactPhone: null,
      course: null, courseIndex: null,
    });
  }
  return sessions.get(phone);
}

function buildCourseList() {
  return COURSES.map((c, i) => `${i + 1}. ${c}`).join('\n');
}

async function handleMessage(phone, text) {
  const session = getSession(phone);
  const trimmed = text.trim();

  switch (session.state) {

    case STATES.NEW: {
      session.state = STATES.WAITING_NAME;
      return {
        reply:
          'שלום! 👋 הגעתם למכללת חמדאן חמדאן.\n\n' +
          'נשמח לעזור לכם להירשם לאחד מהקורסים שלנו.\n\n' +
          'לצורך ההרשמה, אנא שלחו את *שמכם המלא*:',
        update: null,
      };
    }

    case STATES.WAITING_NAME: {
      if (trimmed.length < 2) {
        return { reply: 'אנא כתבו את *שמכם המלא* (שם פרטי + שם משפחה):', update: null };
      }
      session.name = trimmed;
      session.state = STATES.WAITING_LOCATION;
      return {
        reply: `תודה ${session.name}! 😊\n\nאנא שלחו את *מיקומכם* (עיר / ישוב):`,
        update: { name: session.name },
      };
    }

    case STATES.WAITING_LOCATION: {
      if (trimmed.length < 2) {
        return { reply: 'אנא כתבו את *עיר / ישוב* המגורים שלכם:', update: null };
      }
      session.location = trimmed;
      session.state = STATES.WAITING_PHONE;
      return {
        reply: `מצוין! 📍\n\nאנא שלחו את *מספר הטלפון* שלכם (לדוגמה: 0501234567):`,
        update: { location: session.location },
      };
    }

    case STATES.WAITING_PHONE: {
      const digits = trimmed.replace(/[\s\-\+]/g, '');
      if (!/^0[0-9]{8,9}$/.test(digits)) {
        return {
          reply: 'המספר לא תקין. אנא שלחו מספר טלפון ישראלי תקין (לדוגמה: 0501234567):',
          update: null,
        };
      }
      session.contactPhone = digits;
      session.state = STATES.WAITING_COURSE;
      return {
        reply: `תודה! 📞\n\nבאיזה קורס אתם מעוניינים?\n\n${buildCourseList()}\n\nאנא שלחו את המספר המתאים:`,
        update: { contactPhone: digits },
      };
    }

    case STATES.WAITING_COURSE: {
      const choice = parseInt(trimmed, 10);
      if (isNaN(choice) || choice < 1 || choice > COURSES.length) {
        return {
          reply: `אנא בחרו מספר בין 1 ל-${COURSES.length}:\n\n${buildCourseList()}`,
          update: null,
        };
      }
      session.course = COURSES[choice - 1];
      session.courseIndex = choice;
      session.state = STATES.WAITING_DETAILS;

      // בדוק אם יש קובץ פרטים לקורס זה
      const info = await readCourseInfo(choice);
      const detailsOption = info
        ? '\n\nהאם תרצו לקבל פרטים נוספים על הקורס?\n1. כן, שלחו לי פרטים\n2. לא, המשך להרשמה'
        : '';

      return {
        reply: `בחרתם: *${session.course}* 🚌${detailsOption}${!info ? '\n\nמעולה! הפרטים שלכם נשמרו.' : ''}`,
        update: { course: session.course },
        skipComplete: !!info,
      };
    }

    case STATES.WAITING_DETAILS: {
      const choice = parseInt(trimmed, 10);

      // בחר "כן" או כתב משהו שמשמעותו רצון לפרטים
      const wantsDetails =
        choice === 1 ||
        /פרט|מה לומד|שע|עלות|כמה|מחיר|תוכנית|לימוד/i.test(trimmed);

      if (wantsDetails || choice === 1) {
        const info = await readCourseInfo(session.courseIndex);
        if (info) {
          session.state = STATES.DONE;
          return {
            reply:
              `📋 *פרטי ${session.course}:*\n\n${info}\n\n` +
              `✅ הפרטים נקלטו בהצלחה!\n` +
              `👤 ${session.name} | 📍 ${session.location} | 📞 ${session.contactPhone}\n\n` +
              `נציג/ה יחזרו אליך בהקדם 🙏`,
            update: null,
          };
        }
      }

      // "לא" או כל תשובה אחרת → סיים הרשמה
      session.state = STATES.DONE;
      return {
        reply:
          `✅ הפרטים נקלטו בהצלחה!\n\n` +
          `👤 שם: ${session.name}\n` +
          `📍 מיקום: ${session.location}\n` +
          `📞 טלפון: ${session.contactPhone}\n` +
          `🚌 קורס: ${session.course}\n\n` +
          `נציג/ה יחזרו אליך בהקדם 🙏`,
        update: null,
      };
    }

    case STATES.DONE: {
      // שאלה על פרטי קורס — ענה מהקובץ
      const wantsInfo = /פרט|מה לומד|שע|עלות|כמה|מחיר|תוכנית|לימוד/i.test(trimmed);
      if (wantsInfo && session.courseIndex) {
        const info = await readCourseInfo(session.courseIndex);
        if (info) {
          return {
            reply: `📋 *פרטי ${session.course}:*\n\n${info}`,
            update: null,
          };
        }
      }

      // הודעה כלשהי — הבוט מאשר קבלה ומעיר את הפנייה לטיפול
      return {
        reply:
          `שלום ${session.name}! 😊 קיבלנו את פנייתך:\n\n` +
          `"${trimmed}"\n\n` +
          `נציג/ה מהמכללה יחזרו אליך בהקדם לטיפול בבקשתך. תודה! 🙏`,
        update: { status: 'in_progress' },
        reopen: true,
      };
    }

    default:
      session.state = STATES.WAITING_NAME;
      return {
        reply: 'שלום! 👋 הגעתם למכללת חמדאן חמדאן.\n\nאנא שלחו את *שמכם המלא*:',
        update: null,
      };
  }
}

module.exports = { handleMessage, COURSES };
