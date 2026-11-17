import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SQLITE = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# psycopg2

POSTGRESQL = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.getenv('DATABASE_DB'),
        'USER': os.getenv('USER_DB'),
        'PASSWORD': os.getenv('PASSWORD_DB'),
        'HOST': os.getenv('HOST_DB'),
        'PORT': os.getenv('PORT_DB'),
    }
}

# mysqlclient

MYSQL = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.getenv('DATABASE_DB'),
        'USER': os.getenv('USER_DB'),
        'PASSWORD': os.getenv('PASSWORD_DB'),
        'HOST': os.getenv('HOST_DB'),
        'PORT': os.getenv('PORT_DB'),
        'OPTIONS': {
            'sql_mode': 'traditional',
        }
    }
}
