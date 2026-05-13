import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface SubscriberStatusAuditLogAttributes {
  id: number;
  subscriberId: number;
  email: string;
  fromIsActive: boolean | null;
  toIsActive: boolean;
  changeSource: 'subscribe' | 'unsubscribe' | 'admin';
  changeReason: string;
  actor: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubscriberStatusAuditLogCreationAttributes
  extends Optional<SubscriberStatusAuditLogAttributes, 'id' | 'fromIsActive' | 'actor'> {}

class SubscriberStatusAuditLog
  extends Model<SubscriberStatusAuditLogAttributes, SubscriberStatusAuditLogCreationAttributes>
  implements SubscriberStatusAuditLogAttributes {
  public id!: number;
  public subscriberId!: number;
  public email!: string;
  public fromIsActive!: boolean | null;
  public toIsActive!: boolean;
  public changeSource!: 'subscribe' | 'unsubscribe' | 'admin';
  public changeReason!: string;
  public actor!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SubscriberStatusAuditLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    subscriberId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    fromIsActive: {
      type: DataTypes.BOOLEAN,
      allowNull: true
    },
    toIsActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    changeSource: {
      type: DataTypes.ENUM('subscribe', 'unsubscribe', 'admin'),
      allowNull: false
    },
    changeReason: {
      type: DataTypes.STRING,
      allowNull: false
    },
    actor: {
      type: DataTypes.STRING,
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'subscriber_status_audit_logs',
    timestamps: true,
    indexes: [
      { fields: ['subscriberId', 'createdAt'] },
      { fields: ['email', 'createdAt'] }
    ]
  }
);

export default SubscriberStatusAuditLog;