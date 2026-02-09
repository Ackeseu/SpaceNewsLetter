import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface SubscriberAttributes {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  topics: string[];
  regions: string[];
  verificationToken?: string;
  isVerified: boolean;
  unsubscribeToken: string;
  preferencesToken?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubscriberCreationAttributes extends Optional<SubscriberAttributes, 'id' | 'isActive' | 'isVerified' | 'topics' | 'frequency' | 'regions' | 'preferencesToken'> {}

class Subscriber extends Model<SubscriberAttributes, SubscriberCreationAttributes> implements SubscriberAttributes {
  public id!: number;
  public email!: string;
  public firstName?: string;
  public lastName?: string;
  public isActive!: boolean;
  public frequency!: 'daily' | 'weekly' | 'monthly';
  public topics!: string[];
  public regions!: string[];
  public verificationToken?: string;
  public isVerified!: boolean;
  public unsubscribeToken!: string;
  public preferencesToken?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Subscriber.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    frequency: {
      type: DataTypes.ENUM('daily', 'weekly', 'monthly'),
      defaultValue: 'weekly'
    },
    topics: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['general']
    },
    regions: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['global']
    },
    verificationToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    unsubscribeToken: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    preferencesToken: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    }
  },
  {
    sequelize,
    tableName: 'subscribers',
    timestamps: true
  }
);

export default Subscriber;
