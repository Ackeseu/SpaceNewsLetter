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
  declare public id: number;
  declare public email: string;
  declare public firstName?: string;
  declare public lastName?: string;
  declare public isActive: boolean;
  declare public frequency: 'daily' | 'weekly' | 'monthly';
  declare public topics: string[];
  declare public regions: string[];
  declare public verificationToken?: string;
  declare public isVerified: boolean;
  declare public unsubscribeToken: string;
  declare public preferencesToken?: string;
  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
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
