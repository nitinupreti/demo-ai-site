/*
 * Sling Model for the Header component.
 */
package com.demo.core.models;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeaderModel {

    @ValueMapValue
    private String style;

    @ValueMapValue
    private String brandLogo;

    @ValueMapValue
    private String brandText;

    @ValueMapValue
    private String brandAlt;

    @ValueMapValue
    private String brandLink;

    @ValueMapValue
    private String signupLabel;

    @ValueMapValue
    private String signupLink;

    @ValueMapValue
    private String languageLabel;

    @ValueMapValue
    private String languageLink;

    @ChildResource
    private List<NavItemModel> navItems;

    @PostConstruct
    protected void init() {
        if (navItems == null) {
            navItems = Collections.emptyList();
        } else {
            navItems = navItems.stream()
                    .filter(NavItemModel::isHasContent)
                    .collect(Collectors.toList());
        }
    }

    public String getStyle() {
        return StringUtils.defaultIfBlank(style, "default");
    }

    public String getBrandLogo() {
        return brandLogo;
    }

    public String getBrandText() {
        return brandText;
    }

    public String getBrandAlt() {
        return StringUtils.defaultIfBlank(brandAlt, StringUtils.defaultIfBlank(brandText, "Home"));
    }

    public String getBrandLink() {
        return StringUtils.defaultIfBlank(brandLink, "#");
    }

    public String getSignupLabel() {
        return signupLabel;
    }

    public String getSignupLink() {
        return StringUtils.defaultIfBlank(signupLink, "#");
    }

    public String getLanguageLabel() {
        return languageLabel;
    }

    public String getLanguageLink() {
        return StringUtils.defaultIfBlank(languageLink, "#");
    }

    public List<NavItemModel> getNavItems() {
        return navItems;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(brandLogo)
                || StringUtils.isNotBlank(brandText)
                || StringUtils.isNotBlank(brandAlt)
                || !navItems.isEmpty()
                || StringUtils.isNotBlank(signupLabel)
                || StringUtils.isNotBlank(languageLabel);
    }
}
