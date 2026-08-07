/*
 * TOTC Site Header Sling Model.
 */
package com.demo.core.models.totc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;
import org.apache.sling.models.annotations.Default;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SiteHeaderModel {

    @ValueMapValue
    @Default(values = "TOTC")
    private String logoText;

    @ValueMapValue
    @Default(values = "Login")
    private String loginLabel;

    @ValueMapValue
    private String loginLink;

    @ValueMapValue
    @Default(values = "Sign Up")
    private String signupLabel;

    @ValueMapValue
    private String signupLink;

    @ValueMapValue
    @Default(values = "onHero")
    private String theme;

    @ChildResource
    private List<NavLink> navLinks;

    @PostConstruct
    protected void init() {
        if (navLinks == null) {
            navLinks = Collections.emptyList();
        } else {
            List<NavLink> filtered = new ArrayList<>();
            for (NavLink link : navLinks) {
                if (link != null && link.hasContent()) {
                    filtered.add(link);
                }
            }
            navLinks = Collections.unmodifiableList(filtered);
        }
    }

    public String getLogoText() { return logoText; }
    public String getLoginLabel() { return loginLabel; }
    public String getLoginLink() { return loginLink; }
    public String getSignupLabel() { return signupLabel; }
    public String getSignupLink() { return signupLink; }
    public String getTheme() { return theme; }
    public List<NavLink> getNavLinks() { return navLinks; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(logoText)
                || !navLinks.isEmpty()
                || StringUtils.isNotBlank(loginLabel)
                || StringUtils.isNotBlank(signupLabel);
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class NavLink {

        @ValueMapValue
        private String label;

        @ValueMapValue
        private String link;

        public String getLabel() { return label; }
        public String getLink() { return link; }

        public boolean hasContent() {
            return StringUtils.isNotBlank(label);
        }
    }
}
