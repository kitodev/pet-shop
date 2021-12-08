const UserRepository = require('../../database/repositories/userRepository');
const AuthService = require('../../auth/authService');
const assert = require('assert');
const ValidationError = require('../../errors/validationError');

module.exports = class IamStatusChanger {
  constructor(currentUser, language) {
    this.currentUser = currentUser;
    this.language = language;
    this.transaction = null;
  }

  async changeStatus(data) {
    this.data = data;

    await this._validate();

    try {
      this.transaction = await UserRepository.createTransaction();

      await this._loadUsers();
      await this._changeAtDatabase();
      await UserRepository.commitTransaction(
        this.transaction,
      );
    } catch (error) {
      await UserRepository.rollbackTransaction(
        this.transaction,
      );
      throw error;
    }

    await this._changeAtAuthentication();
  }

  get _ids() {
    if (this.data.ids && !Array.isArray(this.data.ids)) {
      return [this.data.ids];
    } else {
      const uniqueIds = [...new Set(this.data.ids)];
      return uniqueIds;
    }
  }

  get _disabled() {
    return !!this.data.disabled;
  }

  async _loadUsers() {
    this.users = await UserRepository.findAllByDisabled(
      this._ids,
      !this._disabled,
      { transaction: this.transaction },
    );
  }

  async _changeAtDatabase() {
    for (const user of this.users) {
      await UserRepository.updateStatus(
        user.id,
        this._disabled,
        {
          transaction: this.transaction,
          currentUser: this.currentUser,
        },
      );
    }
  }

  async _changeAtAuthentication() {
    for (const user of this.users) {
      if (user.authenticationUid) {
        if (user.disabled) {
          await AuthService.enable(user.authenticationUid);
        } else {
          await AuthService.disable(user.authenticationUid);
        }
      }
    }
  }

  async _isDisablingHimself() {
    return (
      this._disabled &&
      this._ids.includes(this.currentUser.id)
    );
  }

  async _validate() {
    assert(this.currentUser, 'currentUser is required');
    assert(
      this.currentUser.id,
      'currentUser.id is required',
    );
    assert(
      this.currentUser.email,
      'currentUser.email is required',
    );

    assert(
      this._ids && this._ids.length,
      'ids is required',
    );

    if (await this._isDisablingHimself()) {
      throw new ValidationError(
        this.language,
        'iam.errors.disablingHimself',
      );
    }
  }
};
